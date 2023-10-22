import { z } from 'zod';
import { firebaseAdmin } from './firebaseadmin';
import * as logger from "firebase-functions/logger";
import { adjectives, names, uniqueNamesGenerator } from 'unique-names-generator';
import crypto from 'crypto';

export const Request = z.object({ //preliminary request object, not final
    uid: z.string().min(1).max(100),
    type: z.string().regex(/^Mentor$/).or(z.string().regex(/^Mentee$/)),
})

const Mentee = z.object({ //not necessarily everything, just all the stuff i need for the matching algorithm
    partnership: z.coerce.boolean(),
    gradeLevel: z.number().int().min(0).max(13),
    subjects: z.string().array(),
    createdAt: z.coerce.date(),
    uid: z.string(),
})

const Mentor = z.object({ //same thing
    partnership: z.coerce.boolean(),
    gradeLevels: z.number().int().min(0).max(13).array(),
    subjects: z.string().array(),
    createdAt: z.coerce.date(),
    uid: z.string(),
})

interface ScoreMentor extends z.infer<typeof Mentor> { //while trying to match
    score: number,
}

interface ScoreMentee extends z.infer<typeof Mentee> { //same
    score: number,
}

export async function generateRandomMentees() {
    const db = firebaseAdmin.getFirestore();

    const ref = db.collection('randomMentees');

    for(let i = 0; i < 100; i++) {
        const id = crypto.randomUUID();

        var randomFirstName = uniqueNamesGenerator({
            dictionaries: [adjectives],
            style: "capital"
        })
    
        var randomLastName = uniqueNamesGenerator({
            dictionaries: [names],
            style: "capital"
        })    

        ref.doc(id).set({
            displayName: randomFirstName + " " + randomLastName,
            partnership: (getRandom(0, 5) == 0 ? true : false),
            subjects: getRandomSubjects(),
            gradeLevel: getRandom(0, 4),
            onboarded: false,
            createdAt: new Date(getRandom(1613152509000, 1679766909000)),
            uid: id
        })
    }
}

export async function generateRandomMentors() {
    const db = firebaseAdmin.getFirestore();

    const ref = db.collection('randomMentors');

    for(let i = 0; i < 100; i++) {
        const id = crypto.randomUUID();

        var randomFirstName = uniqueNamesGenerator({
            dictionaries: [adjectives],
            style: "capital"
        })
    
        var randomLastName = uniqueNamesGenerator({
            dictionaries: [names],
            style: "capital"
        })

        ref.doc(id).set({
            displayName: randomFirstName + " " + randomLastName,
            partnership: (getRandom(0, 5) == 0 ? true : false),
            subjects: getRandomSubjects(),
            gradeLevels: [getRandom(0, 2), getRandom(3, 4)],
            onboarded: false,
            createdAt: new Date(getRandom(1613152509000, 1679766909000)),
            uid: id,
        })
    }
}

export async function findMatches(request: z.infer<typeof Request>) { //this would be the function used in the cloud function
    if(request.type == 'Mentee') {
        const start = new Date();

        let ref = firebaseAdmin.getFirestore().collection('mentees').doc(request.uid);

        let unparsedMentee = (await ref.get()).data();
        if(!unparsedMentee) throw new Error("Mentee Not Found");
        unparsedMentee.uid = ref.id; //put it in before parsing, otherwise zod will throw error.
        let mentee;
        try {
            mentee = Mentee.parse(unparsedMentee);
        } catch(e: any) {
            logger.log(e);
            throw new Error(`Unable to parse mentee ${unparsedMentee.uid}. Error: ${e.message}`);
        }
        

        let refs = await firebaseAdmin.getFirestore().collection('mentors').listDocuments();

        let mentors = new Array<z.infer<typeof Mentor>>();

        for(let i = 0; i < refs.length; i++) { //exactly the same as parsing mentee
            let unparsedMentor = (await refs[i].get()).data();
            if(!unparsedMentor) throw new Error("Mentor Not Found");
            unparsedMentor.uid = refs[i].id;

            try {
                mentors.push(Mentor.parse(unparsedMentor));
            } catch(e: any) {
                logger.log(e);
                throw new Error(`Unable to parse mentor ${unparsedMentor.uid}. Error: ${e.message}`);
            }
        }

        logger.log(`Took ${new Date().valueOf() - start.valueOf()} milliseconds to parse.`);

        return matchMentee(mentee as ScoreMentee, mentors as ScoreMentor[]);
    } else { //same but opposite
        const start = new Date();

        let ref = firebaseAdmin.getFirestore().collection('mentors').doc(request.uid);

        let unparsedMentor = (await ref.get()).data();
        if(!unparsedMentor) throw new Error("Mentor Not Found");
        unparsedMentor.uid = ref.id;

        let mentor;
        try {
            mentor = Mentor.parse(unparsedMentor);
        } catch(e: any) {
            logger.log(e);
            throw new Error(`Unable to parse mentor ${unparsedMentor.uid}. Error: ${e.message}`);
        }

        let refs = await firebaseAdmin.getFirestore().collection('mentees').listDocuments();

        let mentees = new Array<z.infer<typeof Mentee>>();

        for(let i = 0; i < refs.length; i++) {
            let unparsedMentee = (await refs[i].get()).data();
            if(!unparsedMentee) throw new Error("Mentor Not Found");
            unparsedMentee.uid = refs[i].id;

            try {
                mentees.push(Mentee.parse(unparsedMentee));
            } catch(e:any) {
                logger.log(e);
                throw new Error(`Unable to parse mentee ${unparsedMentee.uid}. Error: ${e.message}`);
            }
        }

        logger.log("Done Parsing");

        logger.log(`Took ${new Date().valueOf() - start.valueOf()} milliseconds to parse.`);

        return matchMentor(mentor as ScoreMentor, mentees as ScoreMentee[]);
    }
}

function matchMentee(mentee: ScoreMentee, mentors: ScoreMentor[]) {
    
    mentee.score = 0; //reseting score
    for(let i = 0; i < mentors.length; i++) {
        mentors[i].score = 0;
    }

    logger.log("Reseted Score");

    let unmatchedMentors = [...mentors]; //for now just disregarding onboarded members, we should discuss this behavior.

    logger.log("Split mentors");

    waitCheckMentors(unmatchedMentors);

    logger.log("Wait Checked Mentors");

    subjectMatchMentee(mentee, unmatchedMentors);

    logger.log("Subject Matched Mentee");

    ageMatchmakingMentee(mentee, unmatchedMentors); //goes through scoring all the mentors.

    logger.log("Age Matched Mentee");

    unmatchedMentors.sort((a, b) => { //sorts and returns string array of ids, 0 being best match, and so on
        if(a.score > b.score) {
            return -1;
        }

        if(a.score < b.score) {
            return 1;
        }

        return 0;
    })

    logger.log("Done sorting.");

    let matches = new Array<string>()

    for(let i = 0; i < unmatchedMentors.length; i++) {
        matches.push(unmatchedMentors[i].uid);
    }

    logger.log("Done formatting");

    return matches;
} 

function matchMentor(mentor: ScoreMentor, mentees: ScoreMentee[]) { //similar to matchMentee function
    logger.log(mentor)
    logger.log(mentees.length);

    mentor.score = 0; //reseting score
    for(let i = 0; i < mentees.length; i++) {
        mentees[i].score = 0;
    }

    logger.log("Reseted Score");

    let unmatchedMentees = [...mentees];

    logger.log(unmatchedMentees.length);

    logger.log("Split mentors");

    waitCheckMentees(unmatchedMentees);

    logger.log("Wait Checked Mentors");

    subjectMatchMentor(mentor, unmatchedMentees);

    logger.log("Subject Matched Mentee");

    ageMatchmakingMentor(mentor, unmatchedMentees);

    logger.log("Age Matched Mentee");

    unmatchedMentees.sort((a, b) => {
        if(a.score > b.score) {
            return -1;
        }

        if(a.score < b.score) {
            return 1;
        }

        return 0;
    })

    logger.log("Done sorting.");

    let matches = new Array<string>()

    for(let i = 0; i < unmatchedMentees.length; i++) {
        matches.push(unmatchedMentees[i].uid);
    }

    logger.log("Done formatting");

    return matches;
}   

//look at diagram for more details

function ageMatchmakingMentee(mentee: ScoreMentee, mentorList: ScoreMentor[]){
    for(let i = 0; i < mentorList.length; i++){
        if(mentorList[i].gradeLevels.includes(mentee.gradeLevel)) {
            mentorList[i].score += 9;
        }
    } 
}

function ageMatchmakingMentor(mentor: ScoreMentor, menteeList: ScoreMentee[]){
    for(let i = 0; i < menteeList.length; i++){
        if(mentor.gradeLevels.includes(menteeList[i].gradeLevel)) {
            menteeList[i].score += 9;
        }
    } 
}

function subjectMatchMentor(mentor: ScoreMentor, menteeList: ScoreMentee[]){ //for now weights all subjects evenly, 
    for(let mentee = 0; mentee < menteeList.length; mentee++){
        for(let mentorSubject = 0; mentorSubject < mentor.subjects.length; mentorSubject++){
            let cycleCounter = 0; //feel like this could be a for loop, im going to ask patrick why he did it this way
            for(let menteeSubject = 0; menteeSubject < menteeList[mentee].subjects.length; menteeSubject++) {
                if(menteeList[mentee].subjects[mentorSubject] === mentor.subjects[menteeSubject]) {
                    if (cycleCounter == 0){
                        menteeList[mentee].score+=30;
                    }
                    else if (cycleCounter == 1){
                        menteeList[mentee].score+=30;
                    }
                    else if (cycleCounter == 2){
                        menteeList[mentee].score+=30;
                    }
                    else {
                        menteeList[mentee].score+=10;
                    }
                    cycleCounter += 1; 
                }   
            }
        }
    }
}

function subjectMatchMentee(mentee: ScoreMentee, mentorList: ScoreMentor[]){
    for(let mentor = 0; mentor < mentorList.length; mentor++){
        for(let menteeSubject = 0; menteeSubject < mentee.subjects.length; menteeSubject++){
            let cycleCounter = 0; 
            for(let mentorSubject = 0; mentorSubject < mentorList[mentor].subjects.length; mentorSubject++) {
                if(mentorList[mentor].subjects[mentorSubject] === mentee.subjects[menteeSubject]) {
                    if (cycleCounter == 0){
                        mentorList[mentor].score += 30;
                    }
                    else if (cycleCounter == 1){
                        mentorList[mentor].score += 30;
                    }
                    else if (cycleCounter == 2){
                        mentorList[mentor].score += 30;
                    }
                    else {
                        mentorList[mentor].score += 10;
                    }
                    cycleCounter += 1;
                }
            }
        }
    }
}

/*function splitUnmatchedMentors(mentors: ScoreMentor[]): ScoreMentor[] {
    let filtered = new Array<ScoreMentor>();
    for(let i = 0; i < mentors.length; i++) {
        if(mentors[i].onboarded == false) {
            filtered.push({...mentors[i]});
        }
    }
    return filtered;
}

function splitUnmatchedMentees(mentees: ScoreMentee[]): ScoreMentee[] {
    let filtered = new Array<ScoreMentee>();
    for(let i = 0; i < mentees.length; i++) {
        if(mentees[i].onboarded == false) {
            filtered.push({...mentees[i]});
        }
    }
    return filtered;
}*/

function waitCheckMentees(menteeList: ScoreMentee[]) { //checks how long they have waited (weights different based on partnership)
    for(let i = 0; i < menteeList.length; i++) {
        let timeWaiting = new Date(new Date().valueOf() - menteeList[i].createdAt.valueOf());

        let weeksWaiting = 0;

        if(timeWaiting.getUTCFullYear() > 1970) {
            weeksWaiting += 52 * (timeWaiting.getUTCFullYear() - 1970);
        }

        if(timeWaiting.getUTCMonth() > 0) {
            weeksWaiting += 4 * timeWaiting.getUTCMonth();
        }

        if(timeWaiting.getUTCDate() > 0) {
            weeksWaiting += Math.ceil(timeWaiting.getUTCDate() / 7);
        }

        let score = (weeksWaiting * 0.5);

        menteeList[i].score += menteeList[i].partnership == true ? 10 : (score > 8 ? 8 : score); //removed max eight
    }
}

function waitCheckMentors(mentorList: ScoreMentor[]) { //checks how long they have waited (weights different based on partnership)
    for(let i = 0; i < mentorList.length; i++) {
        let timeWaiting = new Date(new Date().valueOf() - mentorList[i].createdAt.valueOf());

        let monthsWaiting = 0;

        if(timeWaiting.getUTCFullYear() > 1970) {
            monthsWaiting += 12 * (timeWaiting.getUTCFullYear() - 1970);
        }

        monthsWaiting += timeWaiting.getUTCMonth();

        mentorList[i].score += mentorList[i].partnership == true ? (monthsWaiting == 0 ? 0 : (monthsWaiting * 0.5) + 3) : 0;
    }
}

var subjectreference = [
    "Algebra 1",
    "Algebra 2",
    "Living Earth",
    "US History",
    "Econ",
    "French", 
    "English",
    "Chemistry",
    "Geometry",
    "Biology",
    "World History",
    "Spanish",
    "Chinese",
    "Precalc",
]

function getRandomSubjects() {
    var subjects = new Array();
    
    for(var i = 0; i < 3; i++) {
        var randomSubjectNumber = getRandom(0, 13);
        if(subjects.includes(subjectreference[randomSubjectNumber])) {
            var same = randomSubjectNumber;
            while(same == randomSubjectNumber) {
                randomSubjectNumber = getRandom(0, 13);
            }
        }
        subjects.push(subjectreference[randomSubjectNumber]);
    }

    return subjects;
}

function getRandom(min: number, max: number) {
    return Math.floor(Math.random() * ((max + 1) - min) + min);
}