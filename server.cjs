const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'static')));

app.get('*', function (_req, res) {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

app.listen(PORT, function () {
  console.log('Eco-Auditor listening on port ' + PORT);
});