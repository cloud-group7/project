var sqrl = require('squirrelly')
const fs = require('fs')
const AWS = require('aws-sdk');
const busboy = require('busboy')
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3()
const { Buffer } = require("node:buffer");

// load html template
const template = fs.readFileSync('./index.html').toString()

// parameter for full table scan
const params = {
    TableName: 'MusicTable'
}

// policy document for song file to s3 form
const bucketName = "CHANGE_NAME";
const postPolicy = {
    "expiration": "2022-12-30T12:00:00.000Z",
    "conditions": [
        {"acl":"public-read-write" },
        {"bucket":bucketName},
        ["starts-with", "$key", "songs/"],
        ["starts-with", "$Content-Type", "audio/"],
        // needs to be redirected back to homepage
        {"success_action_redirect": ""},
    ],
}


// replace portions of s3 upload form with policy & bucket url
/* 
    either need to replace values in index.html or get the policy
    beforehand and hardcode it
*/
const bucketURL = `https://${bucketName}.s3.amazonaws.com`
const policyB64 = Buffer.from(JSON.stringify(postPolicy), 'utf-8').toString('base64')
// i just hardcoded it for the time being

exports.handler = async (e, ctx) => {

    // log every request into CloudWatch
    console.log(e)

    // handle 'POST /add' for adding songs to DB
    if (e.requestContext.http.method == "POST" && e.requestContext.http.path == "/add") {

        // decode base64 body (if necessary)
        if (e.isBase64Encoded == true) {
            let raw64 = e.body
            let buff = Buffer.from(raw64, 'base64')
            e.body = buff.toString('ascii')
        }

        // get content headers
        var contentType = e.headers['Content-Type'] || e.headers['content-type'];

        // the form object
        let result = {
            Title: "",
            Artist: "",
            fileName:""
        }
        let data = null

        // busboy reads and decodes the event body (form data)
        var bb = busboy({ headers: { 'content-type': contentType }})
        bb.on('file', function (field, file, info) {

            // get file data
            file.on('data', (d) => {
                if (data === null) {
                    data = d
                } else {
                    data = Buffer.concat([data, d])
                }

                // need file.resume(), otherwise .on('finish') will not fire.
                // may have unintended side effects if the file is too large.
                file.resume()
            })

        })
        // handle non-file fields in form
        .on('field', (fieldname, val) => {
            result[fieldname] = val
        })
        .on('finish', () => {  
            // put the song entry into dynamodb
            docClient.put({
                TableName: 'MusicTable',
                Item: {
                    id: `${result.Title}-${result.Artist}`,
                    Title: result.Title,
                    Artist: result.Artist,
                    File: `https://${bucketName}.s3.amazonaws.com/${result.fileName}`
                }
            }, (err, d) => {
                if (err) {
                    console.log(err)
                } else {
                    console.log(d)
                }
            })
        })
        // form parsing error
        .on('error', err => {
            console.log('failed', err);
        })
        // finish form decode
        bb.end(e.body)
    } else {
        // handle default 'GET /' requests

        // scan whole MusicTable
        let scan = await docClient.scan(params).promise()
        let data = {
            songs: []
        }

        // map scan into data object songs array
        do {
            scan.Items.forEach((i) => data.songs.push(i))
            params.ExclusiveStartKey = scan.LastEvaluatedKey
        } while (typeof scan.LastEvaluatedKey != 'undefined')

        // render html template with songs
        return response(sqrl.render(template, data))
    }
}

// returns standard HTML response (for serving template)
function response(html){
    return {
        "statusCode": 200,
        "body": html,
        "headers": {
            "Content-Type": "text/html",
        }
    }
}