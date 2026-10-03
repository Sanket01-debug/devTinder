# DevTinder

**Discover developers. Build connections. Start conversations.**

DevTinder is a developer networking backend that brings profile discovery, connection requests, real-time messaging, and premium memberships into one application. Built with Node.js, Express, and MongoDB, it demonstrates the backend workflows behind a social networking platform for developers.

> This repository contains the backend API and Socket.IO server. A frontend application is maintained separately. This is a portfolio project with production-oriented integrations; deployment hardening and the known issues below remain to be addressed.

## Features

- **Account access:** signup, login, and logout using bcrypt password hashing and JWT cookies.
- **Developer profiles:** names, profile photos, bios, skills, age, and gender, with profile editing.
- **Profile discovery:** a paginated feed that excludes users with existing connection requests.
- **Connection workflow:** express interest, ignore profiles, accept or reject incoming requests, and view connections.
- **Real-time chat:** Socket.IO conversation rooms with messages persisted in MongoDB and chat history available over HTTP.
- **Premium memberships:** Razorpay order creation, payment records, webhook signature verification, and membership status retrieval. Current tiers are Silver (INR 300) and Gold (INR 700).
- **Email notifications:** optional Amazon SES welcome emails and a scheduled reminder job for pending requests from the previous day.

## Technology

| Area | Technologies |
| --- | --- |
| Runtime and API | Node.js, Express 5, JavaScript (CommonJS) |
| Database | MongoDB, Mongoose |
| Authentication and validation | JSON Web Tokens, bcrypt, cookie-parser, validator |
| Real-time messaging | Socket.IO |
| Payments | Razorpay |
| Email and scheduling | Amazon SES, node-cron, date-fns |
| Configuration | dotenv, CORS |

## Architecture

```text
Frontend / API client
    | HTTP requests + cookies       | Socket.IO events
    v                               v
Express routes                  Chat rooms
    |                               |
Authentication middleware           |
    |                               |
Mongoose models <-------------------+
    |
MongoDB

External integrations: Razorpay payments | Amazon SES email
Scheduled task: daily pending-request reminders
```

## Getting started

### Prerequisites

- A Node.js runtime compatible with the dependencies in `package-lock.json` and npm.
- A running MongoDB instance or a MongoDB Atlas connection string.
- Razorpay test-mode credentials: the payment client is initialized when the server starts.
- AWS credentials and a verified SES sender only if email delivery is enabled.

### Install and configure

Clone this repository, open its directory, and install the locked dependencies:

```sh
npm ci
```

Copy the public environment template to `.env`:

```powershell
# Windows PowerShell
Copy-Item .env.local.example .env
```

```sh
# macOS / Linux
cp .env.local.example .env
```

Replace the placeholders with your own credentials. `.env` and `.env.local` are ignored by Git; `.env.local.example` is safe to publish because it contains no real credentials. The application currently loads **`.env`**, so a file named `.env.local` alone will not configure it.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP and Socket.IO server port; use `7777` for the examples below |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret used by authentication middleware; see the signing mismatch below |
| `RAZORPAY_KEY_ID` | Razorpay test-mode key ID for local development |
| `RAZORPAY_KEY_SECRET` | Razorpay API secret |
| `RAZORPAY_WEBHOOK_SECRET` | Secret configured for webhook signature verification |
| `EMAIL_ENABLED` | Set to `true` to enable SES email delivery; otherwise delivery is skipped |
| `EMAIL_FROM` | Verified SES sender address |
| `AWS_ACCESS_KEY` | AWS access key for SES |
| `AWS_SECRET_KEY` | AWS secret key for SES |

SES uses the region `ap-south-1` in `src/utils/sesClient.js`. HTTP and Socket.IO CORS currently allow `http://localhost:5173`.

### Start the server

```sh
npm start
```

With `PORT=7777`, the API is available at `http://localhost:7777`. The server starts listening after MongoDB connects.

For automatic restarts, `npm run dev` invokes `nodemon`. Nodemon is not currently declared in `package.json`; install it as a development dependency before using that script:

```sh
npm install --save-dev nodemon
npm run dev
```

## API reference

Paths below are relative to the server URL. Protected HTTP routes require the `token` cookie returned by signup or login. Browser clients should send requests with `credentials: "include"`.

| Method | Endpoint | Purpose | Authentication |
| --- | --- | --- | --- |
| POST | `/signup` | Create an account | Public |
| POST | `/login` | Sign in and receive a cookie | Public |
| POST | `/logout` | Clear the login cookie | Public |
| GET | `/profile/view` | Read your profile | Cookie |
| PATCH | `/profile/edit` | Update allowed profile fields | Cookie |
| PATCH | `/profile/password` | Password update route; currently needs repair | Cookie |
| GET | `/feed?page=1` | Discover developer profiles | Cookie |
| POST | `/request/send/:status/:toUserId` | Send an `interested` or `ignored` request | Cookie |
| POST | `/request/review/:status/:requestId` | Mark an incoming request `accepted` or `rejected` | Cookie |
| GET | `/user/requests/received` | List incoming pending requests | Cookie |
| GET | `/user/connections` | List accepted connections | Cookie |
| GET | `/chat/:targetUserId` | Retrieve or initialize a conversation | Cookie |
| POST | `/payment/create` | Create an order using `membershipType`: `silver` or `gold` | Cookie |
| POST | `/payment/webhook` | Receive Razorpay payment events | Webhook signature |
| GET | `/premium/verify` | Retrieve user data including membership status | Cookie |

Example signup body:

```json
{
  "firstName": "Sanket",
  "lastName": "Developer",
  "emailId": "developer@example.com",
  "password": "ExampleOnly!42"
}
```

Use your own strong password. Login accepts `emailId` and `password`; profile edits accept `firstName`, `lastName`, `emailId`, `photoUrl`, `gender`, `age`, `about`, and `skills`.

### Socket.IO events

| Event | Direction | Payload |
| --- | --- | --- |
| `joinChat` | Client to server | `firstName`, `userId`, `targetUserId` |
| `sendMessage` | Client to server | `firstName`, `lastName`, `userId`, `targetUserId`, `text` |
| `messageReceived` | Server to room | `senderId`, `firstName`, `lastName`, `text` |

Conversation room IDs are derived from the two user IDs. Socket authentication and connection authorization are still pending; room IDs do not provide access control.

## Project structure

```text
src/
  app.js                  Express, middleware, routes, and HTTP server
  config/database.js      MongoDB connection
  middlewares/auth.js     JWT cookie authentication
  models/                 User, connection request, chat, and payment schemas
  routes/                 Authentication, profiles, discovery, chat, and payments
  utils/                  Validation, sockets, email, scheduling, and payments
.env.local.example        Public configuration template
.gitignore                Dependency and private environment exclusions
package.json              Dependencies and run scripts
package-lock.json         Locked dependency versions
```

## Current limitations and deployment readiness

The following items are visible in the current implementation and should be resolved before a public deployment:

- **Authentication configuration:** `src/models/user.js` signs JWTs with a hardcoded secret, while `src/middlewares/auth.js` verifies them using `JWT_SECRET`. Update signing to use the same environment variable before relying on authenticated flows.
- **Sensitive data handling:** database initialization logs the connection string, and some authentication/profile responses return user documents containing password hashes. Remove sensitive logs and exclude password fields from responses.
- **Password updates:** the route references an unimported `bcrypt` and a `validatePasswordEdit` function that is not exported by the validation utility.
- **Feed pagination:** the route currently reads `page` for both the page number and page size; an independent `limit` parameter needs correction.
- **Chat authorization:** authenticate socket connections and verify conversation access for both socket events and HTTP chat history.
- **Payment handling:** validate membership types, preserve the original webhook body for signature verification, and handle successful, failed, and repeated events explicitly. The current webhook sets premium status without checking for a successful payment event.
- **Deployment configuration:** configure the frontend origin, secure cookie options, HTTPS, and request rate limits for the target environment.
- **Scheduled reminders:** the job runs at 08:00 in the server's timezone. Review the hardcoded destination URL and define the intended timezone before deployment.

No automated test script is currently configured. Before sharing a working demo, verify signup/login, profile editing, connection requests, chat persistence, Razorpay test payments, and optional SES delivery against your own development services.

## Portfolio overview

> Built DevTinder, a developer networking backend using Node.js, Express, and MongoDB. Implemented profile discovery, connection request workflows, JWT cookie authentication, persistent real-time messaging with Socket.IO, Razorpay membership integration, and optional Amazon SES notifications. The project demonstrates API design, data modeling, event-driven communication, and third-party service integration.

This overview can be adapted for a LinkedIn project post. Add your repository link, frontend link, and verified demo screenshots when available.

## Author and license

Created by **Sanket**. The package declares the **ISC** license; add a corresponding `LICENSE` file before public distribution.
