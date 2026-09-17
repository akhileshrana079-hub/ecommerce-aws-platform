const express = require("express");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const dotenv = require("dotenv");
const session = require("express-session");

const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

const {
  getSignedUrl,
} = require("@aws-sdk/s3-request-presigner");

const openid = require("openid-client");

dotenv.config();

const app = express();

const PORT = process.env.PORT || 5001;

const BUCKET_NAME =
  process.env.S3_BUCKET_NAME;

const COGNITO_CLIENT_ID =
  process.env.COGNITO_CLIENT_ID;

const COGNITO_CLIENT_SECRET =
  process.env.COGNITO_CLIENT_SECRET;

const COGNITO_ISSUER_URL =
  process.env.COGNITO_ISSUER_URL;

const COGNITO_DOMAIN =
  process.env.COGNITO_DOMAIN;

const COGNITO_CALLBACK_URL =
  process.env.COGNITO_CALLBACK_URL;

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  `http://localhost:${PORT}`;


// ==========================================
// BASIC CONFIGURATION
// ==========================================

app.set("trust proxy", 1);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json());


// ==========================================
// SESSION
// ==========================================

const isProduction =
  process.env.NODE_ENV === "production";

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "temporary-development-secret",

    resave: false,

    saveUninitialized: false,

    proxy: isProduction,

    cookie: {
      httpOnly: true,

      secure: isProduction,

      sameSite: "lax",

      maxAge:
        60 * 60 * 1000,
    },
  })
);


// ==========================================
// FRONTEND
// ==========================================

app.use(
  express.static(
    path.join(
      __dirname,
      "../frontend"
    )
  )
);


// ==========================================
// MULTER
// ==========================================

const upload =
  multer({
    storage:
      multer.memoryStorage(),
  });


// ==========================================
// AWS S3
// ==========================================

const s3 =
  new S3Client({
    region:
      process.env.AWS_REGION,
  });


// ==========================================
// COGNITO
// ==========================================

let cognitoConfig = null;

async function initializeCognito() {

  if (cognitoConfig) {
    return cognitoConfig;
  }

  cognitoConfig =
    await openid.discovery(
      new URL(
        COGNITO_ISSUER_URL
      ),
      COGNITO_CLIENT_ID,
      COGNITO_CLIENT_SECRET
    );

  console.log(
    "Cognito OIDC configuration loaded."
  );

  return cognitoConfig;
}


// ==========================================
// AUTH MIDDLEWARE
// ==========================================

function requireAuth(
  req,
  res,
  next
) {

  if (!req.session.user) {

    return res.status(401).json({
      success: false,
      message:
        "Authentication required",
    });

  }

  next();
}


// ==========================================
// HOME
// ==========================================

app.get(
  "/",
  (req, res) => {

    if (!req.session.user) {

      return res.redirect(
        "/auth/login"
      );

    }

    res.sendFile(
      path.join(
        __dirname,
        "../frontend/index.html"
      )
    );

  }
);


// ==========================================
// LOGIN
// ==========================================

app.get(
  "/auth/login",
  async (req, res) => {

    try {

      const config =
        await initializeCognito();

      const codeVerifier =
        openid.randomPKCECodeVerifier();

      const codeChallenge =
        await openid.calculatePKCECodeChallenge(
          codeVerifier
        );

      const state =
        openid.randomState();

      req.session.codeVerifier =
        codeVerifier;

      req.session.oauthState =
        state;

      const authorizationUrl =
        openid.buildAuthorizationUrl(
          config,
          {
            redirect_uri:
              COGNITO_CALLBACK_URL,

            scope:
              "openid email",

            code_challenge:
              codeChallenge,

            code_challenge_method:
              "S256",

            state,
          }
        );

      res.redirect(
        authorizationUrl.href
      );

    }

    catch (error) {

      console.error(
        "Login error:",
        error
      );

      res.status(500).send(`
        <h2>Login initialization failed</h2>
        <p>${error.message}</p>
        <p>
          <a href="/auth/login">
            Try login again
          </a>
        </p>
      `);

    }

  }
);


// ==========================================
// COGNITO CALLBACK
// ==========================================

app.get(
  "/auth/callback",
  async (req, res) => {

    try {

      if (!req.query.code) {

        return res.status(400).send(
          "Authorization code missing."
        );

      }

      const config =
        await initializeCognito();

      const callbackUrl =
        new URL(
          COGNITO_CALLBACK_URL
        );

      Object.entries(
        req.query
      ).forEach(
        ([key, value]) => {

          if (Array.isArray(value)) {

            callbackUrl.searchParams.set(
              key,
              value[0]
            );

          } else {

            callbackUrl.searchParams.set(
              key,
              value
            );

          }

        }
      );

      const tokens =
        await openid.authorizationCodeGrant(
          config,
          callbackUrl,
          {
            pkceCodeVerifier:
              req.session.codeVerifier,

            expectedState:
              req.session.oauthState,
          }
        );

      let user = {};

      // ======================================
      // ID TOKEN
      // ======================================

      if (tokens.id_token) {

        const parts =
          tokens.id_token.split(".");

        if (parts.length >= 2) {

          const payload =
            JSON.parse(
              Buffer.from(
                parts[1],
                "base64url"
              ).toString(
                "utf8"
              )
            );

          user = {

            sub:
              payload.sub,

            email:
              payload.email,

            username:
              payload[
                "cognito:username"
              ],

          };

        }

      }


      // ======================================
      // SESSION
      // ======================================

      req.session.user =
        user;

      req.session.tokens = {

        access_token:
          tokens.access_token,

        id_token:
          tokens.id_token,

        refresh_token:
          tokens.refresh_token,

      };

      delete req.session.codeVerifier;

      delete req.session.oauthState;

      console.log(
        "User successfully authenticated:",
        user.email ||
        user.username ||
        user.sub
      );


      // Make sure session is saved
      req.session.save(
        (saveError) => {

          if (saveError) {

            console.error(
              "Session save error:",
              saveError
            );

            return res.status(500).send(
              "Could not save login session."
            );

          }

          res.redirect("/");

        }
      );

    }

    catch (error) {

      console.error(
        "Callback error:",
        error
      );

      res.status(500).send(`
        <h2>Authentication failed</h2>

        <p>
          ${error.message}
        </p>

        <p>
          <a href="/auth/login">
            Try login again
          </a>
        </p>
      `);

    }

  }
);


// ==========================================
// CURRENT USER
// ==========================================

app.get(
  "/api/auth/me",
  (req, res) => {

    if (!req.session.user) {

      return res.status(401).json({
        authenticated: false,
      });

    }

    res.json({

      authenticated: true,

      user:
        req.session.user,

    });

  }
);


// ==========================================
// LOGOUT
// ==========================================

app.get(
  "/auth/logout",
  (req, res) => {

    req.session.destroy(
      (error) => {

        if (error) {

          console.error(
            "Logout error:",
            error
          );

          return res.status(500).send(
            "Logout failed."
          );

        }

        const logoutUrl =
          `${COGNITO_DOMAIN}/logout` +
          `?client_id=${encodeURIComponent(
            COGNITO_CLIENT_ID
          )}` +
          `&logout_uri=${encodeURIComponent(
            COGNITO_CALLBACK_URL
              .replace(
                "/auth/callback",
                "/"
              )
          )}`;

        res.redirect(
          logoutUrl
        );

      }
    );

  }
);


// ==========================================
// LIST S3 FILES
// ==========================================

app.get(
  "/api/files",
  requireAuth,
  async (req, res) => {

    try {

      const command =
        new ListObjectsV2Command({

          Bucket:
            BUCKET_NAME,

        });

      const data =
        await s3.send(
          command
        );

      res.json({

        success: true,

        files:
          data.Contents || [],

      });

    }

    catch (error) {

      console.error(
        "S3 list error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "Failed to list files",

        error:
          error.message,

      });

    }

  }
);


// ==========================================
// UPLOAD FILE
// ==========================================

app.post(
  "/api/files/upload",

  requireAuth,

  upload.single("file"),

  async (req, res) => {

    try {

      if (!req.file) {

        return res.status(400).json({

          success: false,

          message:
            "No file uploaded",

        });

      }

      const command =
        new PutObjectCommand({

          Bucket:
            BUCKET_NAME,

          Key:
            req.file.originalname,

          Body:
            req.file.buffer,

          ContentType:
            req.file.mimetype,

        });

      await s3.send(
        command
      );

      res.json({

        success: true,

        message:
          "File uploaded successfully",

        filename:
          req.file.originalname,

      });

    }

    catch (error) {

      console.error(
        "S3 upload error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "Upload failed",

        error:
          error.message,

      });

    }

  }
);


// ==========================================
// DOWNLOAD FILE
// ==========================================

app.get(
  "/api/files/download/:filename",

  requireAuth,

  async (req, res) => {

    try {

      const filename =
        req.params.filename;

      const command =
        new GetObjectCommand({

          Bucket:
            BUCKET_NAME,

          Key:
            filename,

        });

      const url =
        await getSignedUrl(
          s3,
          command,
          {
            expiresIn: 300,
          }
        );

      res.json({

        success: true,

        url,

      });

    }

    catch (error) {

      console.error(
        "S3 download error:",
        error
      );

      res.status(500).json({

        success: false,

        message:
          "Could not generate download URL",

        error:
          error.message,

      });

    }

  }
);


// ==========================================
// HEALTH CHECK
// ==========================================

app.get(
  "/health",
  (req, res) => {

    res.json({

      success: true,

      message:
        "E-Commerce AWS Analytics API is running",

      authenticated:
        !!req.session.user,

      bucket:
        BUCKET_NAME,

      region:
        process.env.AWS_REGION,

    });

  }
);


// ==========================================
// START SERVER
// ==========================================

async function startServer() {

  try {

    await initializeCognito();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          `Server running on port ${PORT}`
        );

        console.log(
          "AWS S3:",
          BUCKET_NAME
        );

        console.log(
          "Cognito authentication enabled."
        );

      }
    );

  }

  catch (error) {

    console.error(
      "Failed to initialize Cognito:",
      error
    );

    process.exit(1);

  }

}

startServer();