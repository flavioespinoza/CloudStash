// Manta API
//
// https://apidocs.joyent.com/manta/
// https://apidocs.joyent.com/manta/nodesdk.html
// https://github.com/joyent/node-manta
//
// Example config:
//
// Using a keystore file (ssh key file):
//
// {
//   "mount": "/foo/bar",
//   "provider": "manta",
//   "basePath": "~~/stor/",
//   "url": "https://us-east.manta.joyent.com",
//   "user": "user@domain.com"
//   "keyId": "8c:09:65:e3:8c:09:65:e3:8c:09:65:e3:8c:09:65:e3",
//   "keyStore": "/Users/you/.ssh/joyent_id_rsa"
// }
//
// Specifying the key explicitly in config (using contents of ssh key file):
//
// {
//   "mount": "/foo/bar",
//   "provider": "manta",
//   "basePath": "~~/stor/",
//   "url": "https://us-east.manta.joyent.com",
//   "user": "user@domain.com"
//   "keyId": "8c:09:65:e3:8c:09:65:e3:8c:09:65:e3:8c:09:65:e3",
//   "key": "-----BEGIN RSA PRIVATE KEY-----\nLOTS-OF-KEY-DATA-HERE==\n-----END RSA PRIVATE KEY-----"
// }
//
// ----
//
// REVIEW:
//
// !!! We do mkdrip on object write (put/copy/move).  We could be more clever and try the put before doing the mkdrip, 
//     catching any DirectoryDoesNotExistError, and in only that case do the mkdirp and retry the put.
//
// ----
//
// Multipart uploads:
//
//    https://github.com/joyent/node-manta/blob/master/lib/client.js
//    https://github.com/joyent/manta-muskie/blob/master/lib/uploads/common.js
//
// ----
//
var log = require('./../lib/logger').getLogger("manta-driver");

var fs = require('fs');
var path = require('path');

var manta = require('manta');

module.exports = function(params)
{
    var basePath = params.basePath;

    log.debug("Using Manta store, basePath:", basePath);

    // key is "key" if provided, else from "keyStore" file.
    //
    if (params.key64)
    {
        params.key = new Buffer(params.key64, 'base64').toString();
    }
    
    var key = params.key || fs.readFileSync(params.keyStore, 'utf8'); 

    var client = manta.createClient({
        sign: manta.privateKeySigner({
            key: key,
            keyId: params.keyId,
            user: params.user
        }),
        user: params.user,
        url: params.url,
        log: log
    });

    function toSafeLocalPath(user, fileName)
    {
        // path.posix.normalize will move any ../ to the front, and the regex will remove them.
        //
        var safeFilename = path.posix.normalize(fileName).replace(/^(\.\.[\/\\])+/, '');

        // !!! This forms a path of basePath/account_id/app_id/xxxxx - For scale, we assume the account_id
        //     is a GUID (randomly distributed digitis).  In order to keep directories from getting too large, 
        //     we can break down the path further using the first three pairs of characters from the GUID, for
        //     a path like: basePath/AB/CD/EF/GHIJKLxxx/app_id/xxxxx.  In that model, with 100m users acounts,
        //     the first two levels of directories will be "full" (256 entries), and the third level will contain
        //     an average of 6 accounts.
        //
        var filePath = path.posix.join(basePath, user.account_id, user.app_id, safeFilename); 

        return filePath;
    }

    function getEntryDetails(mantaEntry)
    {
        // Convert to Dropbox form
        //
        var entry = { name: mantaEntry.name };
        entry[".tag"] = (mantaEntry.type == "object") ? "file" : "folder";
        entry.size = mantaEntry.size;

        // mantaEntry.etag
        // mantaEntry.mtime
        // mantaEntry.parent (full Manta path)

        return entry;
    }

    log.debug('Manta client setup: %s', client.toString());

    var driver = 
    {
        provider: "manta",
        createDirectory: function(user, dirPath, callback)
        {
            var fullPath = toSafeLocalPath(user, dirPath); 

            client.mkdirp(fullPath, function(err)
            {
                if (err)
                {
                    callback(err);
                }
                else 
                {
                    // !!! Better entry details?  (query existing dir? - may have to wait)
                    //
                    var entry = { type: "directory", name: dirPath };
                    callback(null, getEntryDetails(entry));
                }
            });
        },
        listDirectory: function(user, dirpath, callback)
        {
            var fullPath = toSafeLocalPath(user, dirpath);

            var options = {};

            client.ls(fullPath, options, function(err, res)
            {
                var entries = [];

                if (err)
                {
                    if ((err.code == 'NOTFOUND') || (dirpath == ''))
                    {
                        // If the error is 'not found' and the dir in question is the root dir, we're just
                        // going to ignore that and return an empty dir lising (just means we haven't created
                        // this user/app path yet because it hasn't been used yet).
                        //
                        callback(null, entries);
                    }
                    else
                    {
                        callback(err);
                    }
                }

                res.on('object', function (obj) 
                {
                    log.info("file", obj);
                    entries.push(getEntryDetails(obj));
                });

                res.on('directory', function (dir) 
                {
                    log.info("dir", dir);
                    entries.push(getEntryDetails(dir));
                });

                res.once('error', function (err) 
                {
                    log.error(err);
                    callback(err);
                });

                res.once('end', function () 
                {
                    callback(null, entries);
                });
            });
        },
        getObject: function(user, filename, callback)
        {
            var filePath = toSafeLocalPath(user, filename);

            client.get(filePath, function(err, stream) 
            {
                if (err)
                {
                    if (err.code == 'ResourceNotFound')
                    {
                        // Return null - file doesn't exist
                        callback(null, null);
                    }
                    else
                    {
                        log.error(err);
                        callback(err);
                    }
                }

                callback(null, stream);
            });
        },
        putObject: function(user, filename, callback)
        {
            var filePath = toSafeLocalPath(user, filename);

            client.mkdirp(path.dirname(filePath), function(err)
            {
                if (err)
                {
                    callback(err);
                }
                else
                {
                    // !!! Do we have to do anything special to overwrite existing file?
                    //
                    var options = {};
                    callback(null, client.createWriteStream(filePath, options));
                }
            });
        },
        copyObject: function(user, filename, newFilename, callback)
        {
            var filePath = toSafeLocalPath(user, filename); 
            var newFilePath = toSafeLocalPath(user, newFilename); 
            
            client.mkdirp(path.dirname(newFilePath), function(err)
            {
                if (err)
                {
                    callback(err);
                }
                else
                {
                    // !!! Note: Only copies single file (as opposed to folder), doesn't deal with name conflict / rename
                    //
                    client.ln(filePath, newFilePath, function(err) 
                    {
                        if (err)
                        {
                            callback(err);
                        }
                        else
                        {
                            // !!! Better entry details?  
                            //
                            //        Query source obj before copy?
                            //        Get info on new obj after copy (may have to wait for it to show up)?
                            //
                            var entry = { type: "object", name: newFilename };
                            callback(null, getEntryDetails(entry));
                        }
                    });
                }
            });
        },
        moveObject: function(user, filename, newFilename, callback)
        {
            var filePath = toSafeLocalPath(user, filename); 
            var newFilePath = toSafeLocalPath(user, newFilename); 

            client.mkdirp(path.dirname(newFilePath), function(err)
            {
                if (err)
                {
                    callback(err);
                }
                else
                {
                    // !!! Note: Only moves single file (as opposed to folder), doesn't deal with name conflict / rename
                    //
                    client.ln(filePath, newFilePath, function(err) 
                    {
                        if (err)
                        {
                            callback(err);
                        }
                        else
                        {
                            client.unlink(filePath, function(err)
                            {
                                if (err)
                                {
                                    callback(err);
                                }
                                else
                                {
                                    // !!! Better entry details?  
                                    //
                                    //        Query source obj before move?
                                    //        Get info on obj after move (may have to wait for it to show up)?
                                    //
                                    var entry = { type: "object", name: newFilename };
                                    callback(null, getEntryDetails(entry));
                                }
                            });
                        }
                    });
                }
            });
        },
        deleteObject: function(user, filename, callback)
        {
            // This will remove a file or a directory, so let's hope it's used correctly
            //
            var filePath = toSafeLocalPath(user, filename);

            client.info(filePath, function(err, info) 
            {
                if (err) 
                {
                    callback(err);
                }
                else 
                {
                    log.info("Got entry info on delete:", info);

                    var entry = { name: filename };
                    entry.type = (info.extension == "directory") ? "directory" : "object";

                    client.unlink(filePath, function(err)
                    {
                        if (err) 
                        {
                            callback(err);
                        }
                        else 
                        {
                            callback(null, getEntryDetails(entry));
                        }
                    });
                }
            });
        },
        startMultipartUpload: function(user, callback)
        {
            // Multipart upload RFD - https://github.com/joyent/rfd/blob/master/rfd/0065/README.md
            //
            var tmpPath = path.posix.join(basePath, "temp0000"); 

            var options = {
                account: params.user
            }

            client.createUpload(tmpPath, options, function(err, uploadId)
            {
                if (err)
                {
                    log.error("Error on creatUpload", err);
                    callback(err);
                }
                else
                {
                    log.info("createUpload id:", uploadId);
                    callback(null, uploadId);
                }
            });
        }
    }

    return driver;
}
