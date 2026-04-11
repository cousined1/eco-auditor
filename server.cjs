const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Video file name and possible locations (Railway volume first, then local static)
const VIDEO_FILENAME = 'eco-auditor-intro.mp4';
const VIDEO_PATHS = [
  path.join('/app/videos', VIDEO_FILENAME),              // Railway volume mount
  path.join(__dirname, 'static', VIDEO_FILENAME),        // Local build output
  path.join(__dirname, 'public', VIDEO_FILENAME),        // Dev public dir
];

function findVideoPath() {
  for (const p of VIDEO_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ─── Video streaming route (supports Range requests for seek/resume) ───
app.get('/api/video', function (req, res) {
  const filePath = findVideoPath();
  if (!filePath) {
    return res.status(404).json({ error: 'Video not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // Parse Range header: "bytes=start-end"
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': 'bytes ' + start + '-' + end + '/' + fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'public, max-age=86400',
    });
    fs.createReadStream(filePath, { start: start, end: end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ─── Static files ───
app.use(express.static(path.join(__dirname, 'static')));

// ─── SPA fallback ───
app.get('*', function (_req, res) {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

app.listen(PORT, function () {
  var videoPath = findVideoPath();
  console.log('Eco-Auditor listening on port ' + PORT);
  console.log('Video source: ' + (videoPath || 'NOT FOUND — upload to /app/videos/'));
});