// Unlike log4js, with Bunyan we have to create a single logger instance that the
// entire app shares.  We'll use a singleton pattern to do that here. 
//
// Here is a relevant discussion about this topic: https://github.com/trentm/node-bunyan/issues/116
//
var bunyan = require('bunyan');

var mainLogger;

// This method will only be called once (by the top level app) to pass in the config and create the
// main/root logger.
//
exports.createMainLogger = function(config)
{
    // !!! This is where we would pull info from config to configure Bunyan logging (levels, streams, etc)
    //

    mainLogger = bunyan.createLogger({name: "MantaBox"});
    return mainLogger;
}

// All modules will call this to get a logger (typically by passing at least a category).  If a category
// or any options are passed, an appropriate child logger will be returned.
//
// If you need the main logger for some reason, just call this with no params.
//
exports.getLogger = function(category, options, simple)
{
    if (!category && !options)
    {
        return mainLogger;
    }
    else
    {
        options = options || {}
        options.category = category;
        return mainLogger.child(options, simple);
    }
}