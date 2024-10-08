/*
  Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
  Modifications copyright 2024 Fireproof Storage Incorporated. All Rights Reserved.
  Permission is hereby granted, free of charge, to any person obtaining a copy of this
  software and associated documentation files (the "Software"), to deal in the Software
  without restriction, including without limitation the rights to use, copy, modify,
  merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
  permit persons to whom the Software is furnished to do so.
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
  INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
  PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
  HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
  OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

'use strict'
import AWS from 'aws-sdk'
import { CID } from 'multiformats'
import { base64pad } from 'multiformats/bases/base64'
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand
} from '@aws-sdk/lib-dynamodb'
import { InvocationRequest } from 'aws-sdk/clients/lambda'

// @ts-ignore
const S3_BUCKET = process.env.UploadBucket

// @ts-ignore
// AWS.config.update({region: 'us-east-1'})
AWS.config.update({ region: process.env.AWS_REGION })
const client = new DynamoDBClient({})
const dynamo = DynamoDBDocumentClient.from(client)
const lambda = new AWS.Lambda()

const stackName = process.env.STACK_NAME;
const tableName = `${stackName}-metastore`;

const s3 = new AWS.S3({
  signatureVersion: 'v4'
})

// Change this value to adjust the signed URL's expiration
const URL_EXPIRATION_SECONDS = 300

// Main Lambda entry point
export const handler = async event => {
  return await getUploadURL(event).catch(error => {
    console.error('Error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Internal Server Error',
        error: error.message
      })
    }
  })
}

interface CRDTEntry {
  data: string;
  cid: string;
  parents: string[];
}


const getUploadURL = async function (event) {
  const { queryStringParameters } = event
  const type = queryStringParameters.type
  const name = queryStringParameters.name
  if (!type || !name) {
    throw new Error('Missing name or type query parameter: ' + event.rawQueryString)
  }

  let s3Params

  if (type === 'data' || type === 'file') {
    s3Params = carUploadParams(queryStringParameters, event, type)
    const uploadURL = await s3.getSignedUrlPromise('putObject', s3Params)

    return JSON.stringify({
      uploadURL: uploadURL,
      Key: s3Params.Key
    })
  } else if (type === 'meta') {
    return await metaUploadParams(queryStringParameters, event)
  } else if (type === 'wal') {

    s3Params = walUploadParams(queryStringParameters, event)

    const uploadURL = await s3.getSignedUrlPromise('putObject', s3Params)

    return JSON.stringify({
      uploadURL: uploadURL,
      Key: s3Params.Key
    })
  } else {
    throw new Error('Unsupported upload type: ' + type)
  }
}

// async function invokelambda(event, tableName, dbname) {
//   const commandArgs = {
//     ExpressionAttributeValues: {
//       ":v1": {
//         S: dbname,
//       },
//     },
//     ExpressionAttributeNames: {
//       "#nameAttr": "name",
//       "#dataAttr": "data",
//     },
//     KeyConditionExpression: "#nameAttr = :v1",
//     ProjectionExpression: "cid, #dataAttr",
//     TableName: tableName,
//   };
//   console.log('invokelambda QueryCommand Args:', commandArgs);
//   const command = new QueryCommand(commandArgs);
//   const data = await dynamo.send(command)
//   let items: { [key: string]: any; }[] = []
  
//   if (data.Items && data.Items.length > 0) {
//     items = data.Items.map((item) => {
//       console.log('Before unmarshall:', item);
//       const unmarshalledItem = AWS.DynamoDB.Converter.unmarshall(item);
//       console.log('After unmarshall:', unmarshalledItem);
//       return unmarshalledItem;
//     });
//   }

//   event.body = JSON.stringify({
//     action: "sendmessage",
//     data: JSON.stringify(items),
//   });

//   event.API_ENDPOINT = process.env.API_ENDPOINT;
//   // let str = dbname;
//   // let extractedName = str.match(/\.([^.]+)\./)[1]
//   event.databasename = dbname;

//   const params: InvocationRequest = {
//     FunctionName: process.env.SendMessage as string,
//     InvocationType: "RequestResponse",
//     Payload: JSON.stringify(event),
//   }

//   console.log('Invoking Lambda with Params:', params);
//   const returnedresult: any = await lambda.invoke(params).promise();
//   const result = JSON.parse(returnedresult.Payload);
//   return result;
// }

async function metaUploadParams(queryStringParameters, event) {
  const name = queryStringParameters.name
  const httpMethod = event.requestContext.http.method
  if (httpMethod == 'PUT') {
    console.log('Event:', JSON.stringify(event, null, 2));
    console.log('QueryStringParameters:', JSON.stringify(queryStringParameters, null, 2));
    console.log('HTTP Method:', httpMethod);
    console.log('TableName:', tableName);
    const requestBody = JSON.parse(event.body) as CRDTEntry[]
    if (requestBody) {
      const { data, cid, parents } = requestBody[0]
      if (!data || !cid) {
        throw new Error('Missing data or cid from the metadata:' + event.rawQueryString)
      }

      //name is the partition key and cid is the sort key for the DynamoDB table
      const putCommand = new PutCommand({
        TableName: tableName,
        Item: {
          name: name,
          cid: cid,
          data: JSON.stringify(requestBody[0])
        }
      });
      console.log('PutCommand:', putCommand);
      await dynamo.send(putCommand);

      for (const p of parents) {
        const deleteCommand = new DeleteCommand({
          TableName: tableName,
          Key: {
            name: name,
            cid: p
          }
        });
        console.log('DeleteCommand:', deleteCommand);
        await dynamo.send(deleteCommand);
      }

      // void invokelambda(event, tableName, name).then((result) => {
      //   console.log("This is the response", result)
      // }).catch((error) => {
      //   console.log(error, "This is the error when calling other Lambda")
      //   // return {
      //   //   statusCode: 500,
      //   //   body: JSON.stringify({ error: "Failed to connected to websocket server" }),
      //   // };
      // });

      return {
        statusCode: 201,
        body: JSON.stringify({ message: 'Metadata has been added' })
      }
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'JSON Payload data not found!' })
      }
    }
  } else if (httpMethod === 'GET') {
    const command = new QueryCommand({
      ExpressionAttributeValues: {
        ':v1': {
          S: name
        }
      },
      ExpressionAttributeNames: {
        '#nameAttr': 'name',
        '#dataAttr': 'data'
      },
      KeyConditionExpression: '#nameAttr = :v1',
      ProjectionExpression: 'cid, #dataAttr',
      TableName: tableName
    })
    const data = await dynamo.send(command)
    // const data = await dynamoDB.scan(params).promise();
    //This means items is an array of objects where each object contains a string key and a value of any type
    //: { [key: string]: any; }[]
    // console.log('dynamo result',data)
    let items: { [key: string]: any }[] = []
    if (data.Items && data.Items.length > 0) {
      items = data.Items.map((item) => {
        // console.log('Before unmarshall:', item);
        const dataString = item.data.S;
        // console.log('Data string:', dataString);
        return JSON.parse(dataString);
      });
      console.log('getmeta Items:', items);
      return {
        statusCode: 200,
        body: JSON.stringify(items)
      }
    } else {
      return {
        statusCode: 200,
        body: JSON.stringify([])
      }
    }
  } else {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Invalid HTTP method' })
    }
  }
}

function walUploadParams(queryStringParameters, event) {
  const name = queryStringParameters.name
  if (!name) {
    throw new Error('Missing name query parameter: ' + event.rawQueryString)
  }

  const Key = `wal/${name}.wal`

  const s3Params = {
    Bucket: S3_BUCKET,
    Key,
    Expires: URL_EXPIRATION_SECONDS,
    ContentType: 'application/octet-stream',
    ACL: 'public-read'
  }
  return s3Params
}

function carUploadParams(queryStringParameters, event, type) {
  const name = queryStringParameters.name
  const carCid = queryStringParameters.car
  if (!carCid || !name) {
    throw new Error('Missing name or car query parameter: ' + event.rawQueryString)
  }

  const cid = CID.parse(carCid)
  const checksum = base64pad.baseEncode(cid.multihash.digest)

  const Key = `${type}/${name}/${cid.toString()}.car`

  const s3Params = {
    Bucket: S3_BUCKET,
    Key,
    Expires: URL_EXPIRATION_SECONDS,
    ContentType: 'application/car',
    ChecksumSHA256: checksum,
    ACL: 'public-read'
  }
  return s3Params
}
