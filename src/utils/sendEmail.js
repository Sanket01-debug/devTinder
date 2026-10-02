const { SendEmailCommand } = require("@aws-sdk/client-ses");
const { sesClient } = require("./sesClient.js");

const createSendEmailCommand = (toAddress, fromAddress, subject, body) => {
  return new SendEmailCommand({
    Destination: {
      CcAddresses: [],
      ToAddresses: [toAddress],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: body,
        },
        Text: {
          Charset: "UTF-8",
          Data: "This is the text format email",
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: subject,
      },
    },
    Source: fromAddress,
    ReplyToAddresses: [
      /* more items */
    ],
  });
};

const run = async (subject, body, toEmailId) => {
  // Enable delivery once SES is configured and available.
  if (process.env.EMAIL_ENABLED !== "true") {
    return { skipped: true };
  }

  const sendEmailCommand = createSendEmailCommand(
    toEmailId,
    process.env.EMAIL_FROM || "sanketkansal2001@gmail.com",
    subject,
    body
  );

  return await sesClient.send(sendEmailCommand);
};

// snippet-end:[ses.JavaScript.email.sendEmailV3]
const sendEmail = async ({ to, subject, html }) => {
  return run(subject, html, to);
};

module.exports = sendEmail;
module.exports.run = run;
