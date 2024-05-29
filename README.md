# Fireproof S3 bucket adapter

This uses verified uploads, addressed by content hash identifier.

- User-agent pings a Lambda API with the intended hash identifier and size for the object they are about to upload.
- Using websocket based live connection,a state of the user agent is also maintained by storing the connection Ids of the browser client inside a DynamoDB table
- Lambda returns a signed URL from an AWS account private key. The URL authorizes the holder to upload only the object matching content identifer (thanks to platform level hash validation in S3/R2/Azure).
- The client PUTs to the URL and the content is written.
- At the same time, a JSON object which contains metadata of the uploaded data is uploaded to a DynamoDB table and the parent CIDs are pruned so that only latest content identifier stay inside the records.
- Any other client connected via the same fireproof database is updated about a data upload made by the other client via websocket based message polling. In this way all the connected agents stay updated with the latest data in real time. 
- Subsequent reads for that content identifier will return the content, nothing invalid can overwrite it.

Because the files Fireproof writes are encrypted by the browser, and the metadata is not stored in the bucket but rather inside another key-value based NOSQL database this bucket is safe for public reads.

Read on to learn how to deploy, etc. This is based on...
 
# S3 presigned URLs with SAM

To learn more about how the S3 Upload  works, see the AWS Compute Blog post: https://aws.amazon.com/blogs/compute/uploading-to-amazon-s3-directly-from-a-web-or-mobile-application/

Important: this application uses various AWS services and there are costs associated with these services after the Free Tier usage - please see the [AWS Pricing page](https://aws.amazon.com/pricing/) for details. You are responsible for any AWS costs incurred. No warranty is implied in this example.

```bash
.
├── README.MD                   <-- This instructions file
├── getSignedURL                <-- Source code for the serverless backend
├── onconnect                   <-- Source code for onboarding new clients of same database
├── sendmessage                 <-- Source code for the serverless new updates polling
├── ondisconnect                <-- Source code for deleting live subscribers
```

## Requirements

* AWS CLI already configured with Administrator permission
* [AWS SAM CLI installed](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html) - minimum version 0.48.
* [NodeJS 16.x installed](https://nodejs.org/en/download/)

## Installation Instructions

1. [Create an AWS account](https://portal.aws.amazon.com/gp/aws/developer/registration/index.html) if you do not already have one and login.

2. Clone the repo onto your local development machine using `git clone`.

### Installing the application

```
cd .. 
sam build (Note: esbuild must be installed on the host machine to use this feature. If not installed run this command: sudo npm install -g esbuild)
sam deploy --guided
```

When prompted for parameters, enter:
- Stack Name: s3Uploader (any other name also works fine)
- AWS Region: your preferred AWS Region (e.g. us-east-1)
- Answer 'Yes' to all the questions, and accept others defaults.

This takes several minutes to deploy. At the end of the deployment, note these output values because a typical connect.aws function expects these arguements: database, upload, download and websocket

- The HTTP API endpoint url value is important - it looks like https://ab123345677.execute-api.us-west-2.amazonaws.com/uploads. This value will be passed as an argument to the connect function later for the upload parameter

- Also note the S3 upload Bucket name. The download URL passed looks like this https://${bucketname}.s3.us-east-2.amazonaws.com

- Finally note the WebSocketURI. The websocket argument expects a URL like this wss://v7eax67rm6.execute-api.us-east-2.amazonaws.com/Prod


### Testing with the frontend application

The frontend code is saved in the `frontend` subdirectory. 

1. You can run this directly on a local browser with live server using localhost.To get the experience of real time syncing,run the website on two different browsers and enter the same database name for both

2. Once the pages are loaded,create a new todo in one of your front-end and you will see the object in the backend S3 bucket,metadata inside the metaStore table, connection IDs of two clients inside the subscribersTable and finally live update of the same todo on the second frontend after few seconds

3. We have already provisioned public resources for your testing. Feel free to comment the line 42 inside the HTML file and uncomment line 43 and run the application again now with custom URLs you got from deploying the SAM template

## Next steps

The AWS Compute Blog post at the top of this README file contains additional information about this pattern.

If you have any questions, please raise an issue in the GitHub repo.

==============================================

Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
Modifications Copyright 2024 Fireproof Storage Incorporated. All Rights Reserved.

SPDX-License-Identifier: MIT-0
