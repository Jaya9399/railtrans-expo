const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const visitorsRoutes = require('./routes/visitors');
const speakersRoutes = require('./routes/speakers');
const partnersRoutes = require('./routes/partners');
const exhibitorsRoutes = require('./routes/exhibitors');
const awardeesRoutes = require('./routes/awardees');
const exhibitorConfigRoutes = require('./routes/exhibitorConfig');
const visitorConfigRoutes = require('./routes/visitorConfig');
const partnerConfigRoutes = require('./routes/partnerConfig');
const speakerConfigRoutes = require('./routes/speakerConfig');
const awardeeConfigRoutes = require('./routes/awardeeConfig'); // <-- NEW: Awardee config route
const imageUploadRoutes = require('./routes/imageUpload');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(bodyParser.json());

// Serve uploaded images statically
app.use('/uploads', express.static('uploads'));

// Mount routes
app.use('/api/visitors', visitorsRoutes);
app.use('/api/speakers', speakersRoutes);
app.use('/api/partners', partnersRoutes);
app.use('/api/exhibitors', exhibitorsRoutes);
app.use('/api/awardees', awardeesRoutes);
app.use('/api/exhibitor-config', exhibitorConfigRoutes);
app.use('/api/visitor-config', visitorConfigRoutes);
app.use('/api/partner-config', partnerConfigRoutes);
app.use('/api/speaker-config', speakerConfigRoutes);
app.use('/api/awardee-config', awardeeConfigRoutes); // <-- Mount Awardee config route
app.use('/api', imageUploadRoutes);

// Optional: root route for testing
app.get("/", (req, res) => {
  res.send("API is running");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});