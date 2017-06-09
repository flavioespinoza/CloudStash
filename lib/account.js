// User account info
//
// In production, user account management and auth will be delegated to an external system.  This module is intended
// to be a lightweight auth system suitable for prototyping and testing only.
//
// ACCOUNT
//
// Store:
//
// account_id (unique) - GUID (in Dropbox it's 40 chars, regular GUID is 36 with dashes, 32 without)
// email (unique)
// password_hash - Generated using bcrypt - use bcrypt to compare - https://www.npmjs.com/package/bcryptjs
// given_name
// surname
// email_verified (bool)
// disabled (bool)
//
// Report via Dropbox API:
//
// account_id
// name {
//   given_name
//   surname
//   familiar_name (generage from given_name)
//   display_name (generate from given_name + surname)
//   abbreviated_name (generate from initials)
// }
// email
// email_verified (bool)
// disabled (bool)
//
// ----
//
// Create Account - email + password + given_name + surname
//
// Authenticate - email + password
//
// ----
//
// Authenticate on behalf of user as application
//
// email + password + application_id (00001 is "User file storage" / default?)
//
// ----
//
// JWT contains account_id and application_id
//
/*
var bcrypt = require('bcryptjs');

bcrypt.hash("xxxxxx", 10, function(err, hash)
{
});

bcrypt.compare("xxxxxx", hash, function(err, res) 
{
    if (res)
    {
        // win
    }
    else
    {
        // lose
    }
});
*/