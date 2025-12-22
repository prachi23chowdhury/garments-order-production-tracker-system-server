const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000;

const crypto = require("crypto");


const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



function generateTrackingId() {
    const prefix = "PRCL"; 
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); 
    const random = crypto.randomBytes(3).toString("hex").toUpperCase(); 

    return `${prefix}-${date}-${random}`;
}
// middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  console.log(" AUTH HEADER:", req.headers.authorization);
  console.log(" ALL HEADERS:", req.headers);

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = authHeader.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    console.error(" TOKEN VERIFY ERROR:", err.message);
    return res.status(403).send({ message: "forbidden access" });
  }
};



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6mz34iu.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


async function run() {
  try {
  
    await client.connect();


    const db = client.db("garments_order_db")
    const productsCollection = db.collection("products")
    const ordersCollection = db.collection("orders");
    const usersCollection = db.collection("users");
    const paymentCollection = db.collection("payment");
    const managersCollection = db.collection("manager");


   
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await usersCollection.findOne(query);

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' });
            }

            next();
        }
const verifyManager = async (req, res, next) => {
  const userEmail = req.decoded_email; 
  const user = await usersCollection.findOne({ email: userEmail });
  if (!user || user.role !== "manager") {
    return res.status(403).send({ message: "Forbidden" });
  }
  next();
};

const checkUserStatus = async (req, res, next) => {
  const email = req.decoded_email;
  let user = await usersCollection.findOne({ email });

  
  if (!user) {
    const newUser = {
      email,
      role: "user",
      status: "active",
      createdAt: new Date(),
    };
    const result = await usersCollection.insertOne(newUser);
    user = newUser;
  }

  if (user.status === "suspended") {
    return res.status(403).send({
      message: "Your account is suspended",
      reason: user.reason || "",
      feedback: user.feedback || "",
    });
  }

  next();
};

// user related api

  app.get('/users', verifyFBToken, async (req, res) => {
            const searchText = req.query.searchText;
            const query = {};

            if (searchText) {
                query.$or = [
                    { displayName: { $regex: searchText, $options: 'i' } },
                    { email: { $regex: searchText, $options: 'i' } },
                ]

            }

            const cursor = usersCollection.find(query).sort({ createdAt: -1 }).limit(5);
            const result = await cursor.toArray();
            res.send(result);
        });

        app.get('/users/:id', async (req, res) => {

        })

        app.get('/users/:email/role',verifyFBToken, async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            res.send({ role: user?.role || 'user' })
        })
app.get(
  '/users/email/:email',
  verifyFBToken,        // 🔥 ADD THIS
  async (req, res) => {
    const email = req.params.email;

    if (email !== req.decoded_email) {
      return res.status(403).send({ message: 'Forbidden access' });
    }

    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    res.send({
      _id: user._id,
      name: user.name || user.displayName || "",
      email: user.email,
      photoURL: user.photoURL || "",
      role: user.role || "user",
      status: user.status || "active",
      reason: user.reason || "",
      feedback: user.feedback || "",
      createdAt: user.createdAt,
    });
  }
);


app.post("/users", async (req, res) => {
  const user = req.body;

  user.role = user.role || "user";
  user.status = user.status || "active"; 
  user.createdAt = new Date();

  const exists = await usersCollection.findOne({ email: user.email });
  if (exists) return res.send({ message: "user exist" });

  const result = await usersCollection.insertOne(user);
  res.send(result);
});


 app.patch('/users/:id/role', verifyFBToken,verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const roleInfo = req.body;
            const query = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    role: roleInfo.role
                }
            }
            const result = await usersCollection.updateOne(query, updatedDoc)
            res.send(result);
        })


        app.patch('/users/:id/status', verifyFBToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID" });
        const { status, reason, feedback } = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: { status } };

        if (status === 'suspended') {
            updateDoc.$set.reason = reason || '';
            updateDoc.$set.feedback = feedback || '';
        } else {
            updateDoc.$set.reason = '';
            updateDoc.$set.feedback = '';
        }

        const result = await usersCollection.updateOne(query, updateDoc);
        res.send(result);
    } catch (err) {
        res.status(500).send({ message: "Server error", error: err.message });
    }
});


app.post("/products", verifyFBToken, verifyManager, checkUserStatus, async (req, res) => {
  try {
    const product = req.body;
    product.managerEmail = req.decoded_email; 
    product.createdAt = new Date();

    const result = await productsCollection.insertOne(product);
    res.send({ success: true, product: { _id: result.insertedId, ...product } });
  } catch (err) {
    console.error("Error adding product:", err);
    res.status(500).send({ message: "Failed to add product" });
  }
});

// All products (buyers/public)
app.get("/products", async (req, res) => {
  try {
    const products = await productsCollection.find().toArray();
    res.send(products);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to fetch products" });
  }
});

// Manager's own products
app.get("/products/manager", verifyFBToken, verifyManager, async (req, res) => {
  try {
    const managerEmail = req.decoded_email;
    const products = await productsCollection.find({ managerEmail }).toArray();
    res.send(products);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to fetch manager products" });
  }
});


app.get("/products/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const product = await productsCollection.findOne({ _id: new ObjectId(id) });
    if (!product) return res.status(404).send({ message: "Product not found" });
    res.send(product);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
});




// Update product
app.put("/products/:id", verifyFBToken, verifyManager, async (req, res) => {
  try {
    const id = req.params.id;
    const updates = req.body;

    const product = await productsCollection.findOne({ _id: new ObjectId(id) });
    if (!product) return res.status(404).send({ message: "Product not found" });

    if (product.managerEmail !== req.decoded_email)
      return res.status(403).send({ message: "Not allowed" });

    await productsCollection.updateOne({ _id: new ObjectId(id) }, { $set: updates });
    res.send({ success: true, updatedProduct: { ...product, ...updates } });
  } catch (err) {
    console.error("Error updating product:", err);
    res.status(500).send({ message: "Server error" });
  }
});

// Delete product
app.delete("/products/:id", verifyFBToken, verifyManager, async (req, res) => {
  try {
    const id = req.params.id;

    const product = await productsCollection.findOne({ _id: new ObjectId(id) });
    if (!product) return res.status(404).send({ message: "Product not found" });

    if (product.managerEmail !== req.decoded_email)
      return res.status(403).send({ message: "Not allowed" });

    await productsCollection.deleteOne({ _id: new ObjectId(id) });
    res.send({ success: true, message: "Product deleted successfully" });
  } catch (err) {
    console.error("Error deleting product:", err);
    res.status(500).send({ message: "Server error" });
  }
});


app.patch("/products/:id/show-home", verifyFBToken, async (req, res) => {
  const { showOnHome } = req.body;
  const { id } = req.params;
  
  try {
    const result = await productsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { showOnHome } }
    );
    res.send({ success: true, result });
  } catch (err) {
    res.status(500).send({ success: false, message: err.message });
  }
});




    // our products api
  app.get("/our-products", async (req, res) => {
  const ourProducts = await productsCollection
    .find()
    .sort({ rating: -1 })
    .limit(6)
    .toArray();

  res.send(ourProducts);
});

//  details api


// orders API
   app.post(
  "/orders",
  verifyFBToken,       
  checkUserStatus,
  async (req, res) => {
    const order = req.body;
    order.userEmail = req.decoded_email;
    order.status = "Pending";
    order.createdAt = new Date();

    const result = await ordersCollection.insertOne(order);
    res.send(result);
  }
);



app.get("/orders", verifyFBToken, async (req, res) => {
  try {
    const userEmail = req.decoded_email;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const skip = (page - 1) * limit;

    const total = await ordersCollection.countDocuments({ userEmail });

  
    const orders = await ordersCollection
      .find({ userEmail })
      .sort({ createdAt: -1 }) 
      .skip(skip)
      .limit(limit)
      .toArray();

    res.send({ orders, total });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to fetch orders" });
  }
});


app.get("/orders/all", verifyFBToken, async (req, res) => {
  try {
    const status = req.query.status; 
    const query = {};

    if (status) {
      query.status = status;
    }

    const orders = await ordersCollection.find(query).toArray();
    res.send(orders);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch all orders" });
  }
});




app.get("/orders/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const order = await ordersCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!order) {
      return res.status(404).send({ message: "Order not found" });
    }

    res.send(order);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});




app.patch("/orders/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const updateDoc = {
    $set: {
      status,
    },
  };

  if (status === "Approved") {
    updateDoc.$set.approvedAt = new Date();
  }

  try {
    const result = await ordersCollection.updateOne(
      { _id: new ObjectId(id) },
      updateDoc
    );

    res.send(result);
  } catch (err) {
    res.status(500).send({ message: "Failed to update status" });
  }
});



app.get("/admin/orders", verifyFBToken, verifyAdmin, async (req, res) => {
  const status = req.query.status;

  let query = {};
  if (status) {
    query.status = status;
  }

  const result = await ordersCollection.find(query).toArray();
  res.send(result);
});



 
app.post("/orders/:id/tracking", async (req, res) => {
  const { id } = req.params;
  const trackingData = req.body;

  const newTracking = {
    status: trackingData.status,
    location: trackingData.location,
    note: trackingData.note || "",
    date: new Date(trackingData.date || Date.now()),
  };

  const result = await ordersCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $push: { tracking: newTracking },
      $set: { status: trackingData.status }, 
    }
  );

  res.send(result);
});

app.get("/orders/:id/tracking", async (req, res) => {
  try {
    const { id } = req.params;

    const order = await ordersCollection.findOne(
      { _id: new ObjectId(id) },
      { projection: { tracking: 1 } } 
    );

    if (!order) {
      return res.status(404).send({ message: "Order not found" });
    }

    const tracking = (order.tracking || []).sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    res.send(tracking);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});




    // app.delete("/orders/:id", async (req, res) => {
    //   const result = await ordersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    //   res.send(result);
    // });

    // payment related apis
        app.post('/payment-checkout-session', async (req, res) => {
            const productInfo = req.body;
            const amount = parseInt(productInfo.price) * 100;
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: {
                                name: `Please pay for: ${productInfo.productName}`
                            }
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata: {
                 productId: productInfo.productId,
                productName: productInfo.productName
                },
                customer_email: productInfo.userEmail,
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            })
            console.log(session)
            res.send({ url: session.url })
        })

    app.patch('/payment-success', async (req, res) => {
        try {
            const sessionId = req.query.session_id;

            if (!sessionId) {
                return res.status(400).send({ success: false, message: "No Session ID found" });
            }

            const session = await stripe.checkout.sessions.retrieve(sessionId);

            if (session.payment_status !== 'paid') {
                return res.status(400).send({ success: false, message: "Payment not completed" });
            }

            // Duplicate check
            const alreadyExists = await paymentCollection.findOne({ transactionId: session.payment_intent });
            if (alreadyExists) {
                return res.send({ success: true, message: "Already processed", trackingId: alreadyExists.trackingId });
            }

            const trackingId = generateTrackingId();
            const id = session.metadata.productId;

        
            if (!id || !ObjectId.isValid(id)) {
                 return res.status(400).send({ success: false, message: "Invalid Product ID in metadata" });
            }

            const query = { _id: new ObjectId(id) };
            const update = {
                $set: {
                    paymentStatus: 'paid',
                    trackingId: trackingId,
                    orderStatus: "pending"
                }
            };
            
            const result = await productsCollection.updateOne(query, update);

            const payment = {
                amount: session.amount_total / 100,
                currency: session.currency,
                customerEmail: session.customer_email,
                productId: id,
                productName: session.metadata.productName,
                transactionId: session.payment_intent,
                paymentStatus: session.payment_status,
                paidAt: new Date(),
                trackingId: trackingId
            };

            const resultPayment = await paymentCollection.insertOne(payment);

            res.send({
                success: true,
                modifyProduct: result,
                trackingId: trackingId,
                transactionId: session.payment_intent,
                paymentInfo: resultPayment
            });
            
        } catch (error) {
            console.error("Payment Success Error Details:", error);
            res.status(500).send({ success: false, error: error.message });
        }
    });

    // Payment history
app.get("/payment", verifyFBToken, async (req, res) => {
    try {
        const email = req.query.email;

        if (!email) {
            return res.status(400).send({ message: "Email is required" });
        }

        // email verify
        if (email !== req.decoded_email) {
            return res.status(403).send({ message: "Forbidden access" });
        }

        const query = { customerEmail: email };
        const result = await paymentCollection.find(query).toArray();

        res.send(result);
    } catch (error) {
        res.status(500).send({ message: "Server error" });
    }
});



// manager related api 
       app.get('/managers', async (req, res) => {
            const { status } = req.query;
            const query = {}

            if (status) {
                query.status = status;
            }
            

            const cursor = managersCollection.find(query)
            const result = await cursor.toArray();
            res.send(result);
        })


        app.post('/managers', async (req, res) => {
            const manager = req.body;
            manager.status = 'pending';
            manager.createdAt = new Date();

            const result = await managersCollection.insertOne(manager);
            res.send(result);
        })

        app.patch('/managers/:id', verifyFBToken,verifyAdmin, async (req, res) => {
            const status = req.body.status;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    status: status,
                    // workStatus: 'available'
                }
            }

            const result = await managersCollection.updateOne(query, updatedDoc);

            if (status === 'approved') {
                const email = req.body.email;
                const userQuery = { email }
                const updateUser = {
                    $set: {
                        role: 'manager'
                    }
                }
                const userResult = await usersCollection.updateOne(userQuery, updateUser);
            }

            res.send(result);
        })



    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } 
  finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Garment order and production system server is running ')
});


app.listen(port, () => {
  console.log(`Garment order and production system server is running on port ${port}`)
})
