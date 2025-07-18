const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
dotenv.config();

const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

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
    const paymentsCollection = db.collection("payments");
    const charityRoleRequestsCollection = db.collection("charityRequest");
    const reviewsCollection = db.collection("reviews");
    const donationRequestsCollection = db.collection("donationRequests");

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

    app.get("/charity-transactions/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;

      const payments = await paymentsCollection
        .find({ email })
        .sort({ date: -1 })
        .project({
          transactionId: 1,
          amount: 1,
          paid_at: 1,
          _id: 0,
        })
        .toArray();

      // 2. Status from charityRoleRequestsCollection
      const request = await charityRoleRequestsCollection.findOne(
        { email },
        { projection: { status: 1 } }
      );

      // Final response combines both
      res.send({
        transactions: payments,
        status: request?.status || "Pending",
      });
    });

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

    app.get("/donations/all", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const donations = await donationsCollection.find().toArray();
        res.send(donations);
      } catch (err) {
        console.error("Error fetching all donations:", err);
        res.status(500).send({ message: "Failed to fetch all donations" });
      }
    });

    // GET /charity-role-requests
    app.get(
      "/charity-role-requests",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const requests = await charityRoleRequestsCollection.find().toArray();
        res.send(requests);
      }
    );

    app.get("/donations/verified", async (req, res) => {
      try {
        const verifiedDonations = await donationsCollection
          .find({ status: "Verified" })
          .toArray();

        res.send(verifiedDonations);
      } catch (err) {
        console.error("Error fetching verified donations:", err);
        res.status(500).send({ message: "Failed to fetch verified donations" });
      }
    });

    app.get("/donations/featured", async (req, res) => {
      try {
        const featured = await donationsCollection
          .find({ status: "Verified", featured: true })
          .toArray();
        res.send(featured);
      } catch (err) {
        console.error("Error fetching featured donations:", err);
        res.status(500).send({ message: "Failed to fetch featured donations" });
      }
    });

    app.get("/donations/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const donation = await donationsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!donation) {
          return res.status(404).send({ message: "Donation not found" });
        }
        res.send(donation);
      } catch (error) {
        res.status(500).send({ message: "Server error", error });
      }
    });

    app.patch("/donations/:id/feature", verifyFBToken, async (req, res) => {
      const { id } = req.params;

      try {
        const result = await donationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { featured: true } }
        );
        res.send(result);
      } catch (err) {
        console.error("Error featuring donation:", err);
        res.status(500).send({ message: "Failed to feature donation" });
      }
    });

    // PATCH /charity-role-request/:id
    app.patch(
      "/charity-role-request/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;

        if (!["Approved", "Rejected"].includes(status)) {
          return res.status(400).send({ message: "Invalid status value" });
        }

        const filter = { _id: new ObjectId(id) };

        // First, find the existing charity role request to get email
        const existingRequest = await charityRoleRequestsCollection.findOne(
          filter
        );
        if (!existingRequest) {
          return res.status(404).send({ message: "Charity request not found" });
        }

        const email = existingRequest.email;

        const updateRequest = {
          $set: { status },
        };

        const requestUpdateResult =
          await charityRoleRequestsCollection.updateOne(filter, updateRequest);

        let userUpdateResult = null;

        // If approved, update user's role to 'charity'
        if (status === "Approved" && email) {
          const userFilter = { email };
          const updateUserRole = {
            $set: { role: "charity" },
          };
          userUpdateResult = await usersCollection.updateOne(
            userFilter,
            updateUserRole
          );
        }

        res.send({
          requestModified: requestUpdateResult.modifiedCount > 0,
          userModified: userUpdateResult?.modifiedCount > 0 || false,
        });
      }
    );

    app.patch(
      "/donations/:id/status",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;

        try {
          const result = await donationsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status } }
          );
          res.send(result);
        } catch (err) {
          console.error("Error updating donation status:", err);
          res.status(500).send({ message: "Failed to update status" });
        }
      }
    );

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

    app.post("/reviews", async (req, res) => {
      const review = req.body;
      review.createdAt = new Date();

      try {
        const result = await reviewsCollection.insertOne(review);
        res.send(result);
      } catch (error) {
        console.error("Failed to post review:", error);
        res.status(500).send({ message: "Server Error" });
      }
    });

    app.get("/reviews/:donationId", async (req, res) => {
      const { donationId } = req.params;
      try {
        const reviews = await reviewsCollection
          .find({ donationId })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(reviews);
      } catch (error) {
        console.error("Failed to get reviews:", error);
        res.status(500).send({ message: "Server Error" });
      }
    });

    app.get(
      "/donation-requests/:donationId",
      verifyFBToken, verifyCharity,
      async (req, res) => {
        const { donationId } = req.params;
        const userEmail = req.query.email;

        try {
          const request = await donationRequestsCollection.findOne({
            donationId,
            assignedTo: userEmail,
          });

          res.send(request || {});
        } catch (err) {
          console.error("Error fetching assigned request:", err);
          res.status(500).send({ message: "Failed to fetch assigned request" });
        }
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

    app.post(
      "/donation-requests",
      verifyFBToken,
      verifyCharity,
      async (req, res) => {
        const request = req.body;

        try {
          const result = await donationRequestsCollection.insertOne({
            ...request,
            createdAt: new Date(),
          });

          // Update donation status to 'Requested'
          await donationsCollection.updateOne(
            { _id: new ObjectId(request.donationId) },
            { $set: { dStatus: "Requested" } }
          );

          res.status(201).send({
            message: "Donation request submitted",
            insertedId: result.insertedId,
          });
        } catch (error) {
          console.error("Error submitting request:", error);
          res.status(500).send({ message: "Failed to submit request" });
        }
      }
    );

    app.get("/charity-role-request/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const request = await charityRoleRequestsCollection.findOne(
        { email },
        { projection: { status: 1 } }
      );
      res.send(request || {});
    });

    app.post("/charity-role-request", verifyFBToken, async (req, res) => {
      const {
        email,
        name,
        organization,
        mission,
        amount,
        transactionId,
        paymentMethod,
      } = req.body;

      // Step 1: Check if already exists
      const existing = await charityRoleRequestsCollection.findOne({
        email,
        status: { $in: ["Pending", "Approved"] },
      });

      if (existing) {
        return res
          .status(400)
          .send({ message: "You already submitted a request." });
      }

      // Step 2: Insert Charity Role Request
      const roleDoc = {
        email,
        name,
        organization,
        mission,
        transactionId,
        status: "Pending",
        createdAt: new Date(),
      };

      const roleResult = await charityRoleRequestsCollection.insertOne(roleDoc);

      // Step 3: Save to Transactions
      const paymentDoc = {
        email,
        transactionId,
        amount,
        paymentMethod,
        purpose: "Charity Role Request",
        paid_at: new Date(),
      };

      await paymentsCollection.insertOne(paymentDoc);

      res.status(201).send({
        message: "Role request submitted",
        insertedId: roleResult.insertedId,
      });
    });

    app.post("/create-payment-intent", async (req, res) => {
      const { amountInCents } = req.body;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
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

    app.delete(
      "/donations/:id",
      verifyFBToken,
      verifyRestaurant,
      async (req, res) => {
        const id = req.params.id;

        const result = await donationsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result); // will include deletedCount
      }
    );

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
