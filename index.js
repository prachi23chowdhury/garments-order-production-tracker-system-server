const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
require('dotenv').config()
const port = process.env.PORT || 3000;
const crypto = require("crypto");

const stripe = require('stripe')(process.env.STRIPE_SECRET);
function generateTrackingId() {
    const prefix = "PRCL"; // your brand prefix
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
    const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex

    return `${prefix}-${date}-${random}`;
}
// middleware
app.use(cors());
app.use(express.json());


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
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();


    const db = client.db("garments_order_db")
    const productsCollection = db.collection("products")
    const ordersCollection = db.collection("orders");
    const usersCollection = db.collection("users");
    const paymentCollection = db.collection("payment");


// user related api
app.post("/users", async(req, res) =>{
  const user = req.body;
  
  if (user.role == null || user.role === "") {
    user.role = "user";
  }
  user.createdAt = new Date();

  const email = user.email;
  const userExists = await usersCollection.findOne({email})

  if(userExists){
    return res.send({message: "user exist"})
  }
  const result = await usersCollection.insertOne(user)
  res.send(result);
})

// app.get('/users/:email/role', async (req, res) => {
//     const email = req.params.email;
//     const user = await userCollection.findOne({ email });
//     res.send({ role: user?.role || 'user' });
// });


    // product api
    app.get("/products", async(req, res) =>{
        const result = await productsCollection.find().toArray();  
        res.send(result)
    })

      app.get("/products/:id", async(req, res) =>{
        const id = req.params.id;
        const query = {_id: new ObjectId(id)}
        const result = await productsCollection.findOne(query) 
        res.send(result)
    })
 
     app.post("/products", async(req, res) =>{
        const product = req.body;
        const result = await productsCollection.insertOne(product);
        res.send(result)
    })

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
    app.post("/orders", async (req, res) => {
      const order = req.body;
      order.createdAt = new Date();
      // time
      const result = await ordersCollection.insertOne(order);
      res.send(result);
    });

    app.get("/orders", async (req, res) => {
      const query = {};
      const {email} = req.query;
      if(email){
        query.userEmail = email;
      }
      const cursor = ordersCollection.find(query)
      const result = await cursor.toArray();
      res.send(result);
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

          // Payment success handler fix
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

            // ID check to avoid ObjectId casting error
            if (!id || !ObjectId.isValid(id)) {
                 return res.status(400).send({ success: false, message: "Invalid Product ID in metadata" });
            }

            const query = { _id: new ObjectId(id) };
            const update = {
                $set: {
                    paymentStatus: 'paid',
                    trackingId: trackingId
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
app.get("/payment", async (req, res) => {
    const email = req.query.email;
    if (!email) {
        return res.status(400).send({ message: "Email is required" });
    }
    const query = { customerEmail: email }; 
    const result = await paymentCollection.find(query).toArray();
    res.send(result);
});

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
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
