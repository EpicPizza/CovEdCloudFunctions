/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { Request as FirebaseRequest, onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { Request, findMatches } from "./algorithm";

// Start writing functions

function handleCors(request: FirebaseRequest, response: any): boolean {
    response.set('Access-Control-Allow-Origin', '*');

    if (request.method === 'OPTIONS') {
        response.set('Access-Control-Allow-Methods', 'POST');
        response.set('Access-Control-Allow-Headers', 'Content-Type');
        response.set('Access-Control-Max-Age', '3600');
        response.status(204).send('');

        return true;
    } else {
        return false
    }
}

export const match = onRequest(async (request, response) => {
    if(handleCors(request, response)) return;

    let req;

    try {
        req = Request.parse({ uid: request.body.uid, type: request.body.type });
    } catch(e) {
        response.status(400).end();
        return;
    }
    
    try {
        let result = await findMatches(req);

        logger.log(result);

        response.send(result);
    } catch(e: any) {
        console.log(e);

        if('message' in e && typeof e.message == 'string' && (e.message.startsWith('Unable to parse') || e.message.includes('Not Found'))) {
            response.status(400).send(e.message);
        } else {
            response.status(500).end();
        }
    }
});

/*
export const generate = onRequest(async (request, response) => {
    await generateRandomMentees();

    await generateRandomMentors();

    response.send("Done Generating");
});
*/