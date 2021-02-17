/******************************************************************************
 *  Copyright 2019 ModusBox, Inc.                                             *
 *                                                                            *
 *  info@modusbox.com                                                         *
 *                                                                            *
 *  Licensed under the Apache License, Version 2.0 (the "License");           *
 *  you may not use this file except in compliance with the License.          *
 *  You may obtain a copy of the License at                                   *
 *  http://www.apache.org/licenses/LICENSE-2.0                                *
 *                                                                            *
 *  Unless required by applicable law or agreed to in writing, software       *
 *  distributed under the License is distributed on an "AS IS" BASIS,         *
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  *
 *  See the License for the specific language governing permissions and       *
 *  limitations under the License.                                            *
 ******************************************************************************/

const PkiService = require('../service/PkiService');
const Cookies = require('cookies');
const Constants = require('../constants/Constants');
const fs = require('fs');
const path = require('path');
const util = require('util');

function cookieExtractor (req) {
  let cookies = new Cookies(req);
  let token = cookies.get(Constants.OAUTH.JWT_COOKIE_NAME);
  return token;
};

/**
 * Creates a JWTStrategy to use with passport
 * @see http://www.passportjs.org/packages/passport-jwt/
 */
function createJwtStrategy (extraExtractors) {
  var JwtStrategy = require('passport-jwt').Strategy;
  var ExtractJwt = require('passport-jwt').ExtractJwt;

  var jwtStrategyOpts = {};
  let extractors = [];
  if (extraExtractors) {
    if (Array.isArray(extraExtractors)) {
      extractors = extractors.concat(extraExtractors);
    } else {
      extractors.push(extraExtractors);
    }
  };
  extractors = extractors.concat([ExtractJwt.fromAuthHeaderAsBearerToken(), cookieExtractor]);

  jwtStrategyOpts.jwtFromRequest = ExtractJwt.fromExtractors(extractors);

  jwtStrategyOpts.passReqToCallback = true; // passReqToCallback: If true the request will be passed to the verify callback. i.e. verify(request, jwt_payload, done_callback).
  jwtStrategyOpts.jsonWebTokenOptions = {};
  let certContent;
  if (Constants.OAUTH.EMBEDDED_CERTIFICATE) {
    console.log('Setting Token Issuer certificate from Constants.OAUTH.EMBEDDED_CERTIFICATE');
    certContent = Constants.OAUTH.EMBEDDED_CERTIFICATE;
  } else if (Constants.OAUTH.CERTIFICATE_FILE_NAME) {
    console.log(`Setting Token Issuer certificate from Constants.OAUTH.CERTIFICATE_FILE_NAME: ${Constants.OAUTH.CERTIFICATE_FILE_NAME}`);
    if (Constants.OAUTH.CERTIFICATE_FILE_NAME.startsWith('/')) {
      console.log(`Token Issuer Constants.OAUTH.CERTIFICATE_FILE_NAME absolute path`);
      certContent = fs.readFileSync(Constants.OAUTH.CERTIFICATE_FILE_NAME, 'utf8');
    } else {
      console.log(`Token Issuer Constants.OAUTH.CERTIFICATE_FILE_NAME relative path`);
      certContent = fs.readFileSync(path.join(__dirname, '..', Constants.OAUTH.CERTIFICATE_FILE_NAME), 'utf8');
    }
  } else {
    console.warn(`No value specified for Constants.OAUTH.CERTIFICATE_FILE_NAME or Constants.OAUTH.EMBEDDED_CERTIFICATE. Auth will probably fail to validate the tokens`);
  }
  console.log(`Token Issuer loaded: ${certContent}`);

  jwtStrategyOpts.secretOrKeyProvider = (request, rawJwtToken, done) => {
    done(null, certContent);
  };
  // jwtStrategyOpts.issuer = 'accounts.examplesoft.com';
  jwtStrategyOpts.audience = Constants.OAUTH.APP_OAUTH_CLIENT_KEY; // audience: If defined, the token audience (aud) will be verified against this value.
  let jwtStrategy = new JwtStrategy(jwtStrategyOpts, verifyCallback);
  return jwtStrategy;
}

/**
 * Verifies the basic jwtPayload parameters, whatever it is needed before checking for the specific permissions
 * requested by the req
 *
 * This validates the issuer, sub, that the jwt has groups, and the creates a client and authInfo and calls the callback
 *
 * @param {Request} req http request
 * @param {Object} jwtPayload JWT Payload as an Object
 * @param {function(err, client|false, authInfo)} done callback called with the verification results
 */
function verifyCallback (req, jwtPayload, done) {
  if (!jwtPayload.sub) {
    let message = 'Invalid Authentication info: no sub';
    console.log(`OAuthHelper.verifyCallbak received ${jwtPayload}. Verification failed because ${message}`);
    return done(null, false, message);
  }
  if (!jwtPayload.iss) {
    let message = 'Invalid Authentication info: no iss';
    console.log(`OAuthHelper.verifyCallbak received ${jwtPayload}. Verification failed because ${message}`);
    return done(null, false, message);
  }
  let issuer = jwtPayload.iss;
  if (issuer !== Constants.OAUTH.OAUTH2_ISSUER && issuer !== Constants.OAUTH.OAUTH2_TOKEN_ISS) {
    let message = `Invalid Authentication: wrong issuer ${issuer}, expecting: ${Constants.OAUTH.OAUTH2_ISSUER} or ${Constants.OAUTH.OAUTH2_TOKEN_ISS}`;
    console.log(`OAuthHelper.verifyCallbak received ${jwtPayload}. Verification failed because ${message}`);
    return done(null, false, message);
  }
  if (!jwtPayload.groups) {
    let message = 'Invalid Authentication info: no groups';
    console.log(`OAuthHelper.verifyCallbak received ${jwtPayload}. Verification failed because ${message}`);
    return done(null, false, message);
  }
  console.log(`verifyCallback: user ${jwtPayload.sub} with roles ${jwtPayload.groups}`);
  let foundMTA = jwtPayload.groups.includes(Constants.OAUTH.MTA_ROLE);
  let foundPTA = jwtPayload.groups.includes(Constants.OAUTH.PTA_ROLE);
  let foundEveryone = jwtPayload.groups.includes(Constants.OAUTH.EVERYONE_ROLE);
  let client = null;
  client = { name: jwtPayload.sub };
  let roles = { mta: foundMTA, pta: foundPTA, everyone: foundEveryone };
  for (const group of jwtPayload.groups) {
    roles[group] = true;
  }
  let authInfo = { roles: roles };
  console.log(`verifyCallback: returning authInfo: ${JSON.stringify(authInfo)} `);
  return done(null, client, authInfo);
}

/**
 * Creates a passport OAUth2 authenticating middleware
 *
 * @returns a connect middleware that handles OAuth2
 */
function getOAuth2Middleware () {
  var passport = require('passport');
  let jwtStrategy = createJwtStrategy();
  passport.use(jwtStrategy);
  return (req, res, next) => {
    // Defined in connection-manager-api/server/node_modules/passport/lib/middleware/authenticate.js
    // We add this property to the req and set the failureMessage flag to true so that passport will log the error messages there.
    // Unfortunately passport eats a lot of info ( like the Error objects ) but this way at least we know what happened if we get a 401
    req.session = {};
    passport.authenticate('jwt', { session: false, failureMessage: true })(req, res, next);
    // failWithError: true returns awful html error. , failureMessage: True to store failure message in req.session.messages, or a string to use as override message for failure.
    console.log(`OAuthHelper.getOAuth2Middleware after passport.authenticate. req.session is ${util.inspect(req.session)} res.statusCode: ${util.inspect(res.statusCode)} res.statusMessage: ${util.inspect(res.statusMessage)}`);
  };
}

const handleMiddleware = (middleware, app) => {
  if (Constants.OAUTH.AUTH_ENABLED) {
    console.log(`Enabling OAUTH. Constants.OAUTH.AUTH_ENABLED = ${Constants.OAUTH.AUTH_ENABLED}`);
    app.use('/api/environments', getOAuth2Middleware());
    // https://github.com/apigee-127/swagger-tools/blob/master/docs/Middleware.md#swagger-security
    app.use('/api/environments', middleware.swaggerSecurity({
      OAuth2: oauth2PermissionsVerifier
    }));
  } else {
    console.log(`NOT enabling OAUTH. Constants.OAUTH.AUTH_ENABLED = ${Constants.OAUTH.AUTH_ENABLED}`);
  }
};

/**
 * Validates that the user has the required permissions to execute the operation.
 *
 * callback accepts one
 * argument - an Error if unauthorized. The Error may include "message",
 * "state", and "code" fields to be conveyed to the client in the response
 * body and a "headers" field containing an object representing headers
 * to be set on the response to the client. In addition, if the Error has
 * a statusCode field, the response statusCode will be set to match -
 * otherwise, the statusCode will be set to 403.
 *
 * @param {Request} req HTTP request. req.user and req.authInfo come from the passport verify callback (`return done(null, client, authInfo)`)
 * @param {SecurityDefiniton} securityDefinition SecurityDefiniton from the swagger doc
 * @param {String} scopes scopes required for this operation; from the operation definition in the Swagger doc. Same as req.swagger.security[0].OAuth2
 * @param {(error)} callback function to call with the result. If unauthorized, send the error.
 */
function oauth2PermissionsVerifier (req, securityDefinition, scopes, callback) {
  let user = req.user;
  let authInfo = req.authInfo;
  let apiPath = req.swagger.apiPath;
  let originalUrl = req.originalUrl;
  let error = null;
  console.log(`OAuthHelper.oauth2PermissionsVerifier: user ${util.inspect(user)} authInfo:  ${util.inspect(authInfo)} originalUrl: ${originalUrl} apiPath: ${apiPath}`);
  // Now check that the user has all the roles(scopes)
  let rolesOk = false;
  if (scopes && Array.isArray(scopes) && authInfo && authInfo.roles) {
    for (const scope of scopes) {
      rolesOk = rolesOk || authInfo.roles[scope]; // FIXME Here should be an && since they are all required per definition. Need to review the roles ( like pta should include mta )
    }
  }
  if (!rolesOk) {
    console.log(`API defined scopes: user ${JSON.stringify(user)} does not have the required roles ${JSON.stringify(scopes)}, it has authInfo ${JSON.stringify(authInfo)}`);
    error = new Error(`user does not have the required roles ${scopes}`);
    error.statusCode = 403;
    error.headers = { 'X-AUTH-ERROR': error.message };
    return callback(error);
  }

  if (authInfo.roles.pta) {
    // if PTA, has access to all the DFSPs info
    callback();
    return;
  }
  // Now check specific object access permissions
  // DFSP
  // /\/api\/environments\/(\S*)\/dfsps\/(\S*)/.test(originalUrl))  // doesn't work on http://localhost:3001/api/environments/4/dfsps/jwscerts
  // /environments/{envId}/dfsps/jwscerts, /environments/{envId}/dfsps/{dfspId}/ca:
  if (/\/environments\/{envId}\/dfsps\/{dfspId}/.test(apiPath)) {
    var envId = req.swagger.params['envId'].value;
    var dfspId = req.swagger.params['dfspId'].value;
    PkiService.getDFSPById(envId, dfspId)
      .then(dfsp => {
        let groups = authInfo.roles ? authInfo.roles : {};
        if (!dfsp.securityGroup || groups[dfsp.securityGroup]) {
          callback();
        } else {
          console.log(`DFSP specific scopes: user ${JSON.stringify(user)} does not have the required roles ${JSON.stringify(dfsp.securityGroup)}, it has roles ${JSON.stringify(groups)}`);
          error = new Error(`user does not have the required role ${dfsp.securityGroup}`);
          error.statusCode = 403;
          error.headers = { 'X-AUTH-ERROR': error.message };
          callback(error);
        }
      })
      .catch(err => {
        error = new Error(err.message);
        error.statusCode = 500;
        error.headers = { 'X-AUTH-ERROR': error.message };
        callback(error);
      });
  } else {
    callback(error);
  }
};

module.exports = {
  getOAuth2Middleware,
  oauth2PermissionsVerifier,
  handleMiddleware,
  cookieExtractor,
  createJwtStrategy
};
