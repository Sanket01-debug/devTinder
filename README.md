# DevTinder

DevTinder is a developer networking app where users can discover profiles, send connection requests, and chat with their connections.

I built this project to practice backend development, including authentication, database relationships, real-time messaging, and payment integration.

This repository contains the **Express API and Socket.IO server**.

**[Live application](https://devtinder.work)** · **[Frontend repository](https://github.com/Sanket01-debug/devTinder-web)**

## Features

- Signup, login, and logout with JWT cookies
- Password hashing using bcrypt
- Profile editing with photos, skills, and about information
- Developer discovery with pagination
- Connection requests with interested, ignored, accepted, and rejected states
- Real-time chat with messages stored in MongoDB
- Silver and Gold memberships through Razorpay
- Optional welcome emails and pending-request reminders through Amazon SES

## Tech Stack

| Purpose | Technology |
| --- | --- |
| Server | Node.js, Express |
| Database | MongoDB, Mongoose |
| Authentication | JWT, bcrypt, cookie-parser |
| Validation | validator |
| Real-time chat | Socket.IO |
| Payments | Razorpay |
| Email | Amazon SES |
| Scheduled jobs | node-cron, date-fns |
| Configuration | dotenv |

## Run Locally

### 1. Clone the repository

```bash
git clone https://github.com/Sanket01-debug/devTinder.git
cd devTinder
```

### 2. Install dependencies

```bash
npm ci
```

### 3. Configure environment variables

Copy `.env.local.example` to `.env`.

**Windows PowerShell:**

```powershell
Copy-Item .env.local.example .env
```

**macOS or Linux:**

```bash
cp .env.local.example .env
```

Replace the example values with your own configuration.

| Variable | Description |
| --- | --- |
| `PORT` | Server port, usually `7777` |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | JWT authentication secret |
| `RAZORPAY_KEY_ID` | Razorpay key ID |
| `RAZORPAY_KEY_SECRET` | Razorpay key secret |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook secret |
| `EMAIL_ENABLED` | Set to `true` to enable email delivery |
| `EMAIL_FROM` | SES-verified sender address |
| `AWS_ACCESS_KEY` | AWS access key used by the email client |
| `AWS_SECRET_KEY` | AWS secret key used by the email client |

Use Razorpay test credentials for local development. Keep email delivery disabled unless you have configured AWS credentials and an SES-verified sender.

The application loads `.env`. Keep this file out of version control.

### 4. Start the server

```bash
npm start
```

With `PORT=7777`, the server runs at:

```text
http://localhost:7777
```

The server starts listening after connecting to MongoDB. The local frontend origin is `http://localhost:5173`.

## API Routes

These paths are relative to the backend server. In the deployed application, Nginx forwards requests from `/api` to the backend.

Protected routes require the `token` cookie created during signup or login.

### Authentication and Profiles

| Method | Route | Description |
| --- | --- | --- |
| POST | `/signup` | Create an account |
| POST | `/login` | Sign in |
| POST | `/logout` | Sign out |
| GET | `/profile/view` | View your profile |
| PATCH | `/profile/edit` | Edit profile details |
| PATCH | `/profile/password` | Update password |

### Discovery and Connections

| Method | Route | Description |
| --- | --- | --- |
| GET | `/feed` | Fetch developer profiles |
| POST | `/request/send/:status/:toUserId` | Send an interested or ignored request |
| POST | `/request/review/:status/:requestId` | Accept or reject an incoming request |
| GET | `/user/requests/received` | View pending requests |
| GET | `/user/connections` | View accepted connections |

### Chat and Payments

| Method | Route | Description |
| --- | --- | --- |
| GET | `/chat/:targetUserId` | Fetch conversation history |
| POST | `/payment/create` | Create a membership payment order |
| POST | `/payment/webhook` | Receive Razorpay payment events |
| GET | `/premium/verify` | Check membership status |

Browser requests to protected endpoints should include credentials.

```js
axios.get(`${BASE_URL}/profile/view`, {
  withCredentials: true,
});
```

## Connection Requests

A user can mark a profile as `interested` or `ignored`. The recipient can then accept or reject an interested request.

Accepted requests appear in both users’ connection lists. The discovery feed excludes profiles that already have a request relationship with the current user.

## Real-Time Chat

Socket.IO handles live messages between users. Conversation history is stored in MongoDB and loaded through the chat API.

| Event | Purpose |
| --- | --- |
| `joinChat` | Join a conversation room |
| `sendMessage` | Send a message |
| `messageReceived` | Receive a message in the conversation |

Conversation rooms are derived from the two users’ IDs.

## Project Structure

| Path | Contents |
| --- | --- |
| `src/app.js` | Express application and HTTP server |
| `src/config/` | Database configuration |
| `src/middlewares/` | Authentication middleware |
| `src/models/` | User, request, chat, and payment models |
| `src/routes/` | API routes |
| `src/utils/` | Validation, sockets, email, and scheduled jobs |
| `.env.local.example` | Environment configuration template |

## Current Status

This project is still being improved. The current implementation has a few items to address:

- Use the same environment-based secret for JWT signing and verification.
- Remove sensitive logs and exclude password hashes from API responses.
- Repair password update validation and feed pagination.
- Add socket authentication and conversation access checks.
- Tighten payment event handling and webhook body verification.
- Configure cookies, CORS, and the reminder job timezone for deployment.

Amazon SES email delivery depends on the account’s verification and production-access status. No automated test suite is currently configured.

## Author

**Sanket Kansal**

[GitHub](https://github.com/Sanket01-debug)
