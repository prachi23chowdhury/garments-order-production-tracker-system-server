const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
require('dotenv').config()
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

// garmentsOrderDBUser
// mBTlTr3XgfqYalmC
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


// user related api
app.post("/users", async(req, res) =>{
  const user = req.body;
  user.role = "user";
  user.createdAt = new Date();

  const result = await usersCollection.insertOne(user)
  res.send(result);
})

    // product api
    app.get("/products", async(req, res) =>{
        const result = await productsCollection.find().toArray();  
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
app.get("/products/:id", async (req, res) => {
  const id = parseInt(req.params.id); 
  const result = await productsCollection.findOne({ id: id });
  res.send(result);
});

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

    app.delete("/orders/:id", async (req, res) => {
      const result = await ordersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
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
