import express from "express";
import cors from "cors";
import bodyParser from "body-parser";

const app = express();
app.use(cors());
app.use(bodyParser.json());

let users = {}; // demo storage, replace with Firestore if needed

// Get account info
app.get("/get-account/:uid", (req, res) => {
  const uid = req.params.uid;
  if (!users[uid]) {
    return res.json({ error: "User not found" });
  }
  res.json(users[uid]);
});

// Upgrade user
app.post("/upgrade/:uid", (req, res) => {
  const uid = req.params.uid;
  const { plan, amountPaid } = req.body;
  if (!users[uid]) return res.json({ error: "User not found" });

  // Upgrade logic
  users[uid].plan = plan;
  users[uid].balance += amountPaid; // backend tracks balance
  res.json({ success: true, newPlan: plan, newBalance: users[uid].balance });
});

app.listen(3000, () => console.log("Server running on port 3000"));
