const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
dotenv.config();

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')

const serviceAccount = JSON.parse(decoded);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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
    // await client.connect();

    const db = client.db("FoodLinkDB");
    const usersCollection = db.collection("users");
    const donationsCollection = db.collection("donations");
    const paymentsCollection = db.collection("payments");
    const charityRoleRequestsCollection = db.collection("charityRequest");
    const reviewsCollection = db.collection("reviews");
    const donationRequestsCollection = db.collection("donationRequests");
    const favoritesCollection = db.collection("favorites");

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
      const { location, sort } = req.query;

      const query = { status: "Verified" };

      // If location search was submitted
      if (location) {
        query.location = { $regex: new RegExp(location, "i") }; // case-insensitive match
      }

      // Base query
      let cursor = donationsCollection.find(query);

      // Apply sorting
      if (sort === "quantityA") {
        cursor = cursor.sort({ quantity: 1 }); // ascending
      } else if(sort === "quantityD"){
        cursor = cursor.sort({ quantity: -1 });
      }
      else if (sort === "pickupTime") {
        cursor = cursor.sort({ "pickupWindow.start": 1 });
      }

      const result = await cursor.toArray();
      res.send(result);
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

    app.get(
      "/donation-requests/:donationId",
      verifyFBToken,
      verifyCharity,
      async (req, res) => {
        const { donationId } = req.params;
        const userEmail = req.query.email;

        try {
          const request = await donationRequestsCollection.findOne({
            donationId: donationId, // string match
            charityEmail: userEmail, // email match
          });

          res.send(request || {});
        } catch (err) {
          console.error("Error fetching charity's request:", err);
          res.status(500).send({ message: "Failed to fetch request" });
        }
      }
    );

    app.get("/categories", async(req, res) =>{
      const donations = await donationsCollection
        .find({}, { projection: { foodType: 1 } })
        .toArray();

      const categoriesSet = new Set();
      donations.forEach((donation) => {
        if (donation.foodType) {
          categoriesSet.add(donation.foodType);
        }
      });

      res.send([...categoriesSet]);
    })

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

    app.patch(
      "/donation-requests/:donationId",
      verifyFBToken,
      verifyCharity,
      async (req, res) => {
        const { donationId } = req.params;
        const { status, charityEmail } = req.body;

        try {
          // Match donationId and charityEmail
          const result = await donationRequestsCollection.updateOne(
            { donationId, charityEmail },
            { $set: { status } }
          );

          if (status === "Picked Up" && result.modifiedCount > 0) {
            await donationsCollection.updateOne(
              { _id: new ObjectId(donationId) },
              { $set: { dStatus: "Picked Up" } }
            );
          }

          res.send({
            message: "Request updated",
            modified: result.modifiedCount > 0,
          });
        } catch (err) {
          console.error("Error updating request status:", err);
          res.status(500).send({ message: "Failed to update status" });
        }
      }
    );

    app.patch(
      "/donation-requests/accept/:id",
      verifyFBToken,
      async (req, res) => {
        const { id } = req.params;

        try {
          const acceptedRequest = await donationRequestsCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!acceptedRequest) {
            return res.status(404).send({ message: "Request not found" });
          }

          const donationId = acceptedRequest.donationId;

          // 1. Accept the selected request
          await donationRequestsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "Accepted" } }
          );

          // 2. Reject all other requests for the same donation
          await donationRequestsCollection.updateMany(
            { donationId, _id: { $ne: new ObjectId(id) } },
            { $set: { status: "Rejected" } }
          );

          // 3. Update the donation status and set charity name
          await donationsCollection.updateOne(
            { _id: new ObjectId(donationId) },
            {
              $set: {
                dStatus: "Assigned",
                charityName: acceptedRequest.charityName,
              },
            }
          );

          res.send({ success: true });
        } catch (error) {
          console.error("Error accepting request:", error);
          res.status(500).send({ message: "Failed to accept request" });
        }
      }
    );

    app.patch(
      "/donation-requests/reject/:id",
      verifyFBToken,
      async (req, res) => {
        const { id } = req.params;
        try {
          const result = await donationRequestsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "Rejected" } }
          );
          res.send(result);
        } catch (error) {
          console.error("Failed to reject request:", error);
          res.status(500).send({ message: "Failed to reject request" });
        }
      }
    );

    app.post("/favorites", verifyFBToken, async (req, res) => {
      const { email, donationId } = req.body;

      try {
        // Optional: check for duplicates
        const existing = await favoritesCollection.findOne({
          email,
          donationId,
        });
        if (existing) {
          return res.status(400).send({ message: "Already in favorites" });
        }

        const result = await favoritesCollection.insertOne({
          ...req.body,
          createdAt: new Date(),
        });

        res.status(201).send({
          message: "Added to favorites",
          insertedId: result.insertedId,
        });
      } catch (err) {
        console.error("Error adding to favorites:", err);
        res.status(500).send({ message: "Failed to add favorite" });
      }
    });

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

    app.get("/reviews", verifyFBToken, async (req, res) => {
      const userEmail = req.query.email;

      try {
        const reviews = await reviewsCollection
          .find({ reviewerEmail: userEmail })
          .sort({ createdAt: -1 })
          .toArray();

        // Optionally fetch donation titles
        const donationIds = reviews.map((r) => new ObjectId(r.donationId));
        const donations = await donationsCollection
          .find({ _id: { $in: donationIds } })
          .toArray();
        const donationMap = {};
        donations.forEach((d) => {
          donationMap[d._id.toString()] = d;
        });

        const enriched = reviews.map((review) => ({
          ...review,
          donationTitle: donationMap[review.donationId]?.title || "Unknown",
          restaurantName:
            donationMap[review.donationId]?.restaurantName || "Unknown",
        }));

        res.send(enriched);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch reviews" });
      }
    });

    app.get(
      "/my-donation-requests",
      verifyFBToken,
      verifyCharity,
      async (req, res) => {
        const email = req.query.email;
        try {
          const requests = await donationRequestsCollection
            .find({ charityEmail: email })
            .toArray();
          res.send(requests);
        } catch (error) {
          res.status(500).send({ message: "Failed to fetch requests" });
        }
      }
    );

    app.delete("/donation-requests/:id", verifyFBToken, async (req, res) => {
  const id = req.params.id;
  try {
    const request = await donationRequestsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (request?.status !== "Pending") {
      return res
        .status(400)
        .send({ message: "Only pending requests can be canceled" });
    }

    const result = await donationRequestsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    res.send(result);
  } catch (error) {
    console.error("Failed to delete request:", error);
    res.status(500).send({ message: "Failed to delete request" });
  }
});

app.delete("/donation-requests/:id/admin", verifyFBToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await donationRequestsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount > 0) {
      res.send({ success: true, message: "Donation request deleted by admin." });
    } else {
      res.status(404).send({ success: false, message: "Request not found." });
    }
  } catch (error) {
    console.error("Error deleting donation request:", error);
    res.status(500).send({ success: false, message: "Internal server error." });
  }
});

    app.get(
      "/donation-requests/:donationId",
      verifyFBToken,
      verifyCharity,
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

    app.get("/favorites", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ message: "Email is required" });

      try {
        const favorites = await favoritesCollection.find({ email }).toArray();

        const donationIds = favorites.map(
          (fav) => new ObjectId(fav.donationId)
        );
        const donations = await donationsCollection
          .find({ _id: { $in: donationIds } })
          .toArray();

        // Attach favorite _id for deletion
        const result = donations.map((donation) => {
          const fav = favorites.find(
            (f) => f.donationId === donation._id.toString()
          );
          return {
            ...donation,
            favoriteId: fav?._id?.toString(),
          };
        });

        res.send(result);
      } catch (err) {
        console.error("Failed to get favorites", err);
        res.status(500).send({ message: "Failed to fetch favorites" });
      }
    });

    app.get("/donation-requests", verifyFBToken, async (req, res) => {
      try {
        const requests = await donationRequestsCollection.find().toArray();
        res.send(requests);
      } catch (error) {
        console.error("Failed to get donation requests:", error);
        res.status(500).send({ message: "Failed to get donation requests" });
      }
    });

    app.get("/latest-charity-requests", async (req, res) => {
      try {
        const requests = await donationRequestsCollection
          .find({})
          .sort({ createdAt: -1 })
          .limit(3)
          .toArray();

        const emails = requests.map((r) => r.charityEmail);
        const users = await usersCollection
          .find({ email: { $in: emails } })
          .project({ email: 1, name: 1, photo: 1 })
          .toArray();

        const enrichedRequests = requests.map((req) => {
          const user = users.find((u) => u.email === req.charityEmail);
          return {
            ...req,
            charityName: user?.name || req.charityName,
            charityImage: user?.photo || null,
          };
        });

        res.send(enrichedRequests);
      } catch (err) {
        console.error("Failed to fetch latest charity requests", err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get(
      "/restaurant-donation-requests",
      verifyFBToken,
      async (req, res) => {
        const restaurantName = req.query.restaurantName;
        try {
          const requests = await donationRequestsCollection
            .find({ restaurantName })
            .toArray();
          res.send(requests);
        } catch (error) {
          console.error("Error fetching restaurant requests:", error);
          res.status(500).send({ message: "Internal server error" });
        }
      }
    );

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


    app.delete("/reviews/:id", verifyFBToken, async (req, res) => {
      const { id } = req.params;
      try {
        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to delete review" });
      }
    });

    app.delete("/favorites/:id", verifyFBToken, async (req, res) => {
      const { id } = req.params;

      try {
        const result = await favoritesCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Favorite not found" });
        }

        res.send({ message: "Favorite removed" });
      } catch (err) {
        console.error("Error removing favorite:", err);
        res.status(500).send({ message: "Failed to remove favorite" });
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

    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
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
