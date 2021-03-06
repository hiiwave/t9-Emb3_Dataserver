var express = require('express');
var bodyParser = require('body-parser');
var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);
var port = process.env.PORT || 5000;
var mongoose = require( 'mongoose' );
var fanio = io.of('/fanfeed');

var reqHandlers = {
  monitorHandler: function(dbCol, imgCol, socket) {
    var monitorAgent = { 
      init: function() {
        console.log('A monitor connected');
        var intervalId = this.updateClock();
        this.sendHistoryData();
        socket.on('disconnect', function() {
          console.log('monitor disconnected'); 
          clearInterval(intervalId);
        });
      },
      updateClock: function() {
        socket.emit('date', {'date': new Date()});
        return setInterval(function() { 
          socket.emit('date', {'date': new Date()});
          // console.log("My port is " + process.env.PORT);
        }, 5000);
      },
      sendHistoryData: function() {
        dbCol.count({}, function(err, count) {
          socket.emit('countDb', count);  
        });   
        imgCol.count({}, function(err, count) {
          socket.emit('countImg', count);  
        });   
        var historyStream = dbCol.find().sort({date : -1}).limit(5).stream();
        historyStream.on('data', function (pkt) {
          socket.emit('historyPkt', pkt);  
        });
      }
    };
    monitorAgent.init(); 
  },
  fanMonitorHandler: function(socket) {
    var monitorAgent = {
      init: function() {
        console.log('A monitor connected');
        var intervalId = this.updateClock();
        socket.on('disconnect', function() {
          console.log('monitor disconnected'); 
          clearInterval(intervalId);
        });
      },
      updateClock: function() {
        socket.emit('date', {'date': new Date()});
        return setInterval(function() { 
          socket.emit('date', {'date': new Date()});
          // console.log("My port is " + process.env.PORT);
        }, 2000);
      }
    };
    monitorAgent.init();
  },
  feedHandler: function(dbCol, req, res) {
    var post_request_body = '';
    req.on('data', function (data) {
       post_request_body += data;
    });
    req.on('end', function (data) {
      var pkt;
      try {
        pkt = JSON.parse(post_request_body);
      } catch(e) {
        console.err(e);
      }
      io.sockets.emit('newPkt', pkt);
      var lab2doc = new dbCol(pkt);
      lab2doc.save(function(err, lab2doc) {  // Save to db
        if (err)  return console.error(err);
        console.log("SAVE a document");
        res.send('Server GOT your data!');
      }); 
    });
  },
  feedImgHandler: function(dbCol, req, res) {
    var post_request_body = '';
    req.on('data', function (data) {
       post_request_body += data;
    });
    req.on('end', function (data) {
      var imgpkt;
      try {
        imgpkt = JSON.parse(post_request_body);
        console.log("Get image: " + imgpkt.raw);
        console.log("Got image type: " + imgpkt.contentType);
      } catch(e) {
        console.err(e);
      }
      imgpkt.raw = new Buffer(imgpkt.raw);
      var lab2img = new dbCol({
        date: new Date(),
        img: { 
          raw: imgpkt.raw, 
          contentType: imgpkt.contentType,
          hello: 3.5
        }
      });
      lab2img.save(function(err, lab2img) {  // Save to db
        if (err)  return console.error(err);
        console.log("SAVE an Image");
        res.send('Server GOT your image!');
      }); 
      imgpkt.raw = imgpkt.raw.toString('base64');
      // console.log("Encode image to: " + imgpkt.raw);
      io.sockets.emit('newImg', imgpkt);
    });    
  },
  feedFanHandler: function(req, res) {
    var post_request_body = '';
    req.on('data', function (data) {
       post_request_body += data;
    });
    req.on('end', function (data) {
      var pkt;
      try {
        pkt = JSON.parse(post_request_body);
      } catch(e) {
        console.err(e);
      }
      fanio.emit('newPkt', pkt);
      res.send('Server GOT your data!');
    });
  },
  reqSpotHandler: function(dbCol, req, res) {
    var idBegin 
    var idBegin = req.body.idBegin,
        idEnd = req.body.idEnd;
    dbCol.find().sort({_id : +1}).limit(idEnd - idBegin + 1)
                .skip(idBegin - 1).lean().exec(function (err, docs) {
      res.send(JSON.stringify(docs));
    }); 
  }
}
var getLab2Collection = function() {
  var Lab2Schema = mongoose.Schema({
    date: Date,
    noise: Number,
    temparature: Number,
    humidity: Number,
    lat: Number,
    lng: Number
  });
  return mongoose.model('Lab2Collection', Lab2Schema);
}
var getLab2ImgCol = function() {
  var Lab2ImgSchema = mongoose.Schema({
    date: Date,
    img: { 
      raw: Buffer, 
      contentType: String
    }
  });
  return mongoose.model('Lab2ImgCol', Lab2ImgSchema);
}

server.listen(port, function() {
  console.log("Express server listening on port %d", server.address().port);
});
var mongodbUrl = (process.env.MONGOLAB_URI)? process.env.MONGOLAB_URI
    : 'mongodb://heroku_app35998051:nvjupt69fjpud7br66se29r23f@ds035167.mongolab.com:35167/heroku_app35998051';
// To use local database, active this:
mongodbUrl = (process.env.MONGOLAB_URI)? process.env.MONGOLAB_URI : 'mongodb://localhost/test';  // for using local database
mongoose.connect(mongodbUrl);
console.log("mongodbUrl = " + mongodbUrl);

var db = mongoose.connection;
db.on('error', function (err) {
  console.error('Database connection error: ' + err);
  console.log("Note: it's free to continue if only using fanmonitor/ fanfeed");
})
// db.on('error', console.error.bind(console, 'Database connection error: '));
db.once('open', function (callback) {
  console.log("Database open");
  var Lab2Collection = getLab2Collection();
  var Lab2ImgCol = getLab2ImgCol();

  io.on('connection', function (socket) {  // connection setup for monitor.html
    reqHandlers.monitorHandler(Lab2Collection, Lab2ImgCol, socket);
  });
  app.post('/feed', function (req, res) {
    reqHandlers.feedHandler(Lab2Collection, req, res);
  });
  app.post('/feedimg', function (req, res) {
    reqHandlers.feedImgHandler(Lab2ImgCol, req, res);
  });
  app.post('/reqspot', function (req, res) {
    reqHandlers.reqSpotHandler(Lab2Collection, req, res);
  });
});

app.use(bodyParser.json());
fanio.on('connection', function (socket) {  // connection setup for monitor.html
  reqHandlers.fanMonitorHandler(socket);
});
app.post('/feedfan', function (req, res) {
  reqHandlers.feedFanHandler(req, res);
});
app.use(express.static('public'));





