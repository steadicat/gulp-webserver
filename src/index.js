var through = require('through2');
var gutil = require('gulp-util');
var http = require('http');
var connect = require('connect');
var connectLivereload = require('connect-livereload');
var tinyLr = require('tiny-lr');
var watch = require('node-watch');
var fs = require('fs');
var serveIndex = require('serve-index');
var path = require('path');
var url = require('url');
var enableMiddlewareShorthand = require('./enableMiddlewareShorthand');
var mime = require('mime');

var types = {
  '.eot': 'Fonts',
  '.woff': 'Fonts',
  '.ttf': 'Fonts',
  '.otf': 'Fonts',
  '.svg': 'Fonts',
  '.png': 'Images',
  '.jpg': 'Images',
  '.css': 'CSS',
  '.js': 'JavaScript'
};

var lrServer;
var files = {};
var app;

function getConfig(options) {
    var defaults = {

    /**
     *
     * BASIC DEFAULTS
     *
     **/

    host: 'localhost',
    port: 8000,
    fallback: false,

    /**
     *
     * MIDDLEWARE DEFAULTS
     *
     * NOTE:
     *  All middleware should defaults should have the 'enable'
     *  property if you want to support shorthand syntax like:
     *
     *    webserver({
     *      livereload: true
     *    });
     *
     */

    // Middleware: Livereload
    livereload: {
      enable:false,
      port: 35729
    },

    // Middleware: Directory listing
    // For possible options, see:
    //  https://github.com/expressjs/serve-index
    directoryListing: {
      enable: false,
      path: './',
      options: undefined
    }

  };

  // Deep extend user provided options over the all of the defaults
  // Allow shorthand syntax, using the enable property as a flag
  return enableMiddlewareShorthand(defaults, options, ['directoryListing','livereload']);
}

function createApp(config) {
  var app = connect();

  if (config.livereload.enable) {

    app.use(connectLivereload({
      port: config.livereload.port
    }));

    lrServer = tinyLr();
    lrServer.listen(config.livereload.port);

  }

  if (config.directoryListing.enable) {

    function getType(p) {
      return types[path.extname(p)] || 'Others';
    }

    function readablizeBytes(bytes) {
      var s = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
      var e = Math.floor(Math.log(bytes) / Math.log(1024));
      return (bytes / Math.pow(1024, e)).toFixed(1) + " " + s[e];
    }

    function sortF(a, b) {
      var ext = getType(a).localeCompare(getType(b));
      if (ext !== 0) return ext;
      var dir = path.dirname(a).localeCompare(path.dirname(b));
      if (dir !== 0) return dir;
      return a.localeCompare(b);
    }

    app.use(function(req, res, next) {
      if (req.url != '/') return next();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.write('<html style="font-family: \'open sans\', \'source sans pro\', sans-serif; font-size: 14px; line-height: 20px; padding: 0 5% 5%"><div>');
      var lastType = null;
      var lastDir = null;
      Object.keys(files).sort(sortF).forEach(function(p) {
        var type = getType(p);
        var dir = path.dirname(p);
        var base = path.basename(p);
        if (type !== lastType) {
          res.write('</div><div style="display: inline-block; vertical-align: top; width: 23%; margin: 0 1%"><h2>'+type+'</h2>');
          lastType = type;
          lastDir = null;
        }
        if (dir !== lastDir) {
          res.write('<h4>'+dir+'</h4>');
          lastDir = dir;
        }
        res.write('<div style="margin-left: 5%; position: relative;"><a style="text-decoration:none" href="'+p+'">'+base+'</a> <span style="color: #999; font-size: 12px; position: absolute; right: 0; top: 4px">'+readablizeBytes(files[p].contents.toString().length)+'</span></div>');
      });
      res.write('</div></html>');
      res.end();
    });

  }

  app.use(function(req, res) {
    var p = url.parse(req.url).pathname;
    if (files[p]) {
      gutil.log(gutil.colors.green('Serving'), gutil.colors.cyan(p));
      var body = files[p].contents;
      res.setHeader('Content-Type', mime.lookup(p) + '; charset=utf-8');
      res.write(body);
      res.end();
    } else {
      gutil.log(gutil.colors.red('Not found'), gutil.colors.cyan(p));
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.write('Not found');
      res.end();
    }
  });

  var webserver = http.createServer(app).listen(config.port, config.host);
  gutil.log('Webserver started at', gutil.colors.cyan('http://' + config.host + ':' + config.port));

  /*
  stream.on('kill', function() {
    webserver.close();
    if (config.livereload.enable) {
      lrServer.close();
    }
  });
   */

  return app;
}

module.exports = function(options) {
  var config = getConfig(options);
  app || (app = createApp(config));

  // Create server
  var stream = through.obj(function(file, enc, callback) {
    if (file.isStream()) {
      return callback(new Error('Streams are not supported'));
    }

    var url = '/' + path.relative(file.base, file.path);
    gutil.log(gutil.colors.magenta('Updating'), gutil.colors.cyan(url));
    files[url] = file;

    if (config.fallback) {
      var fallbackFile = file.path + '/' + config.fallback;
      if (fs.existsSync(fallbackFile)) {
        app.use(function(req, res) {
          fs.createReadStream(fallbackFile).pipe(res);
        });
      }
    }

    if (config.livereload.enable) {
      lrServer && lrServer.changed({
        body: {
          files: file.path
        }
      });
    }

    this.push(file);
    callback();

  });

  stream.resume();
  return stream;
};
