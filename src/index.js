var sqrl = require('squirrelly');
const fs = require('fs');
const AWS = require('aws-sdk');
const busboy = require('busboy');
const docClient = new AWS.DynamoDB.DocumentClient();

const s3 = new AWS.S3({ region: "us-east-1", signatureVersion: 'v4',});
const bucketName = "cloud-uml-bucket-1090";
var credentials = new AWS.SharedIniFileCredentials({profile: 'ana1'});
AWS.config.credentials = credentials;

// load html template
const template = fs.readFileSync('./index.html').toString()

// parameter for full table scan
const params = {
    TableName: 'MusicTable'
}

exports.handler = async (e, ctx) => {

    // log every request into CloudWatch
    console.log(e)

    // handle 'POST /add' for adding songs to DB
    if (e.requestContext.http.method == "POST" && e.requestContext.http.path == "/add") {

        // decode base64 body (if necessary)
        if (e.isBase64Encoded == true) {
            let raw64 = e.body
            let buff = Buffer.from(raw64, 'base64')
            e.body = buff
        }

        // get content headers
        var contentType = e.headers['Content-Type'] || e.headers['content-type'];

        // the form object
        let result = {
            filename: "",
            Title: "",
            Artist: ""
        }
        let data = null

        // create the file name
        let r = Math.floor((Math.random() * 10000000000000000)).toString(36)
        result.filename = 'songs/' + r + '.mp3'

        // busboy reads and decodes the event body (form data)
        var bb = busboy({ headers: { 'content-type': contentType }})
        bb.on('file', function (field, file, info) {
            // handle a file in the form            
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
            // when the file is completely processed
            // put the song entry into dynamodb
            docClient.put({
                TableName: 'MusicTable',
                Item: {
                    id: `${result.Title}-${result.Artist}`,
                    Title: result.Title,
                    Artist: result.Artist,
                    File: `https://cloud-uml-bucket-1090.s3.amazonaws.com/${result.filename}`
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
        // finish form 
        bb.end(e.body)

        let urlParams = {
            Bucket: bucketName, 
            Key: result.filename,
            ContentType:'audio/mpeg',
        };

        const presignedURL = s3.getSignedUrl('putObject', urlParams)

        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
            },
            "body": {
                "url":  presignedURL,
            }
        };
        

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