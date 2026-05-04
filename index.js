//ttsl/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const truckRoutes = require('./routes/truckRoutes.js');
require('./truckHelpers/cronJobs.js');

const app = express();
//const port = 5000;
app.use(cors());
app.use(express.json());



app.use("/api", truckRoutes);

app.listen(5000, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:5000`);
});




