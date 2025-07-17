const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const serviceAccount = require("./food-donation-sdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.saov0by.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("FoodLinkDB");
    const usersCollection = db.collection("users");
    const donationsCollection = db.collection("donations");

    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = authHeader.split(" ")[1];
      //console.log("token in the middleware", token);
      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      // verify the token
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(403).send({ message: "forbidden access" });
      }
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyCharity = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "charity") {
        return res.status(403).send({ message: "Forbidden: Charity only" });
      }
      next();
    };

    const verifyRestaurant = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "restaurant") {
        return res.status(403).send({ message: "Forbidden: Restaurant only" });
      }
      next();
    };

    const verifyEmailMatch = (req, res, next) => {
      const tokenEmail = req.decoded?.email;
      const paramEmail = req.params.email || req.query.email || req.body.email;
      //console.log('param',paramEmail);

      if (!tokenEmail || tokenEmail !== paramEmail) {
        return res.status(403).send({ message: "Forbidden: Email mismatch" });
      }

      next();
    };

    app.get(
      "/users/:email/role",
      verifyFBToken,
      verifyEmailMatch,
      async (req, res) => {
        try {
          const email = req.params.email;

          if (!email) {
            return res.status(400).send({ message: "Email is required" });
          }

          const user = await usersCollection.findOne({ email });

          if (!user) {
            return res.status(404).send({ message: "User not found" });
          }

          res.send({ role: user.role || "user" });
        } catch (error) {
          console.error("Error getting user role:", error);
          res.status(500).send({ message: "Failed to get role" });
        }
      }
    );

    app.get("/users", async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.status(200).send(users);
      } catch (error) {
        console.error("Failed to fetch users:", error);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    app.get("/donations", verifyFBToken, verifyEmailMatch, async (req, res) => {
      const userEmail = req.query.email;

      if (!userEmail) {
        return res.status(400).send({ message: "Email is required" });
      }

      try {
        const donations = await donationsCollection
          .find({ restaurantEmail: userEmail })
          .toArray();
        res.send(donations);
      } catch (err) {
        console.error("Error fetching donations:", err);
        res.status(500).send({ message: "Failed to fetch donations" });
      }
    });

    app.patch(
      "/donations/:id",
      verifyFBToken,
      verifyRestaurant,
      async (req, res) => {
        const id = req.params.id;
        const updated = req.body;

        const result = await donationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updated }
        );

        res.send(result);
      }
    );

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { role } = req.body;

        if (!["admin", "restaurant", "charity"].includes(role)) {
          return res.status(400).send({ message: "Invalid role" });
        }

        try {
          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role } }
          );
          res.send({ message: `User role updated to ${role}`, result });
        } catch (error) {
          console.error("Error updating user role", error);
          res.status(500).send({ message: "Failed to update user role" });
        }
      }
    );

    app.post(
      "/donations",
      verifyFBToken,
      verifyRestaurant,
      async (req, res) => {
        const newDonation = req.body;
        const result = await donationsCollection.insertOne(newDonation);
        res.send(result);
      }
    );

    app.post("/users", async (req, res) => {
      const email = req.body.email;
      const userExists = await usersCollection.findOne({ email });
      if (userExists) {
        return res
          .status(200)
          .send({ message: "User already exists", inserted: false });
      }
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.delete("/users/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      console.log(id);

      const user = await usersCollection.findOne({ _id: new ObjectId(id) });
      if (!user) return res.status(404).send("User not found");

      try {
        if (user.firebaseUid) {
          await admin.auth().deleteUser(user.firebaseUid);
        }

        await usersCollection.deleteOne({ _id: new ObjectId(id) });

        res.send({ message: "User deleted from Firebase and MongoDB" });
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to delete user", details: error });
      }
    });

    app.delete("/donations/:id", verifyFBToken, verifyRestaurant, async (req, res) => {
      const id = req.params.id;

      const result = await donationsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result); // will include deletedCount
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("food donation server is running");
});

app.listen(port, () => {
  console.log(`server is running on port ${port}`);
});
