import dotenv from 'dotenv';
import { z } from 'zod';
import { firebaseAdmin } from './firebaseadmin';
import * as logger from "firebase-functions/logger";
dotenv.config();

export const Request = z.object({ //preliminary request object, not final
    uid: z.string().min(1).max(100),
    type: z.string().regex(/^Mentor$/).or(z.string().regex(/^Mentee$/)),
})

const Mentee = z.object({ //not necessarily everything, just all the stuff i need for the matching algorithm
    partnership: z.coerce.boolean(),
    grade_level: z.number().int().min(0).max(4),
    subjects: z.string().array(),
    created_at: z.date(),
    onboarded: z.boolean(),
    uid: z.string(),
})

const Mentor = z.object({ //same thing
    partnership: z.coerce.boolean(),
    grade_levels: z.number().int().min(0).max(4).array(),
    subjects: z.string().array(),
    created_at: z.date(),
    onboarded: z.boolean(),
    uid: z.string(),
})

interface ScoreMentor extends z.infer<typeof Mentor> { //while trying to match
    score: number,
}

interface ScoreMentee extends z.infer<typeof Mentee> { //same
    score: number,
}

export async function findMatches(request: z.infer<typeof Request>) { //this would be the function used in the cloud function
    if(request.type == 'Mentee') {
        let ref = firebaseAdmin.getFirestore().collection('mentees').doc(request.uid);

        let unparsedMentee = (await ref.get()).data();
        if(!unparsedMentee) throw new Error("Mentee Not Found");
        unparsedMentee.uid = ref.id; //put it in before parsing, otherwise zod will throw error.
        unparsedMentee.created_at = unparsedMentee.created_at.toDate(); //EEROREORORORORORRROOOOOR
        let mentee = Mentee.parse(unparsedMentee);

        let refs = await firebaseAdmin.getFirestore().collection('mentors').listDocuments();

        let mentors = new Array<z.infer<typeof Mentor>>();

        for(let i = 0; i < refs.length; i++) { //exactly the same as parsing mentee
            let unparsedMentor = (await refs[i].get()).data();
            if(!unparsedMentor) throw new Error("Mentor Not Found");
            unparsedMentor.uid = refs[i].id;
            unparsedMentor.created_at = unparsedMentor.created_at.toDate(); //EEROREORORORORORRROOOOOR
            mentors.push(Mentor.parse(unparsedMentor));
        }

        return matchMentee(mentee as ScoreMentee, mentors as ScoreMentor[]);
    } else { //same but opposite
        let ref = firebaseAdmin.getFirestore().collection('mentors').doc(request.uid);

        let unparsedMentor = (await ref.get()).data();
        if(!unparsedMentor) throw new Error("Mentor Not Found");
        unparsedMentor.uid = ref.id;
        unparsedMentor.created_at = unparsedMentor.created_at.toDate(); //EEROREORORORORORRROOOOOR
        let mentor = Mentor.parse(unparsedMentor);

        let refs = await firebaseAdmin.getFirestore().collection('mentees').listDocuments();

        let mentees = new Array<z.infer<typeof Mentee>>();

        for(let i = 0; i < refs.length; i++) {
            let unparsedMentee = (await refs[i].get()).data();
            if(!unparsedMentee) throw new Error("Mentor Not Found");
            unparsedMentee.uid = refs[i].id;
            unparsedMentee.created_at = unparsedMentee.created_at.toDate(); //EEROREORORORORORRROOOOOR
            mentees.push(Mentee.parse(unparsedMentee));
        }

        logger.log("Done Parsing");

        return matchMentor(mentor as ScoreMentor, mentees as ScoreMentee[]);
    }
}

function matchMentee(mentee: ScoreMentee, mentors: ScoreMentor[]) {
    
    mentee.score = 0; //reseting score
    for(let i = 0; i < mentors.length; i++) {
        mentors[i].score = 0;
    }

    logger.log("Reseted Score");

    let unmatchedMentors = splitUnmatchedMentors(mentors); //for now just disregarding onboarded members, we should discuss this behavior.

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

    let unmatchedMentees = splitUnmatchedMentees(mentees);

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
        if(mentorList[i].grade_levels.includes(mentee.grade_level)) {
            mentorList[i].score += 9;
        }
    } 
}

function ageMatchmakingMentor(mentor: ScoreMentor, menteeList: ScoreMentee[]){
    for(let i = 0; i < menteeList.length; i++){
        if(mentor.grade_levels.includes(menteeList[i].grade_level)) {
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

function splitUnmatchedMentors(mentors: ScoreMentor[]): ScoreMentor[] {
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
}

function waitCheckMentees(menteeList: ScoreMentee[]) { //checks how long they have waited (weights different based on partnership)
    for(let i = 0; i < menteeList.length; i++) {
        let timeWaiting = new Date(new Date().valueOf() - menteeList[i].created_at.valueOf());

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
        let timeWaiting = new Date(new Date().valueOf() - mentorList[i].created_at.valueOf());

        let monthsWaiting = 0;

        if(timeWaiting.getUTCFullYear() > 1970) {
            monthsWaiting += 12 * (timeWaiting.getUTCFullYear() - 1970);
        }

        monthsWaiting += timeWaiting.getUTCMonth();

        mentorList[i].score += mentorList[i].partnership == true ? (monthsWaiting == 0 ? 0 : (monthsWaiting * 0.5) + 3) : 0;
    }
}
