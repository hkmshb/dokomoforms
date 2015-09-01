(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (global){
// vendor
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null),
    $ = (typeof window !== "undefined" ? window['jQuery'] : typeof global !== "undefined" ? global['jQuery'] : null),
    PouchDB  = require('pouchdb/dist/pouchdb.min');

// pouch plugin
PouchDB.plugin(require('pouchdb-upsert'));

// components
var Title = require('./components/baseComponents/Title'),
    Header = require('./components/Header'),
    Footer = require('./components/Footer'),
    Question = require('./components/Question'),
    Note = require('./components/Note'),
    MultipleChoice = require('./components/MultipleChoice'),
    Photo = require('./components/Photo'),
    Location = require('./components/Location'),
    Facility = require('./components/Facility'),
    Submit = require('./components/Submit'),
    Splash = require('./components/Splash'),

    // api services
    PhotoAPI = require('./api/PhotoAPI'),
    FacilityTree = require('./api/FacilityAPI');

/*
 * Create Single Page App with three main components
 * Header, Content, Footer
 */
var Application = React.createClass({displayName: "Application",
    getInitialState: function() {
        // Set up db for photos and facility tree
        var trees = {};
        var surveyDB = new PouchDB(this.props.survey.id, {
            'auto_compaction': true
        });
        window.surveyDB = surveyDB;

        // Build initial linked list
        var questions = this.props.survey.nodes;
        var first_question = null;
        questions.forEach(function(node, idx) {
            var question = node;
            question.prev = null;
            question.next = null;
            if (idx > 0) {
                question.prev = questions[idx - 1];
            }

            if (idx < questions.length - 1) {
                question.next = questions[idx + 1];
            }

            if (idx === 0) {
                first_question = question;
            }

        });

        // Recursively construct trees
        this.buildTrees(questions, trees);

        return {
            showDontKnow: false,
            showDontKnowBox: false,
            head: first_question,
            question: null,
            headStack: [], //XXX Stack of linked list heads
            states : {
                SPLASH : 1,
                QUESTION : 2,
                SUBMIT : 3
            },
            state: 1,
            trees: trees,
            db: surveyDB
        };
    },

    /*
     * Create Facility Tree object at node id for every facility tree question
     * Recurse into subnodes if found
     *
     * @questions: all nodes at current sub level
     * @trees: dictionary of question ids and facility trees
     *
     * NOTE: facility trees update exact same location in pouchdb (based on bounds of coordinates)
     * i.e: Multiple trees with same bounds do not increase memory usage (network usage does increase though)
     */
    buildTrees: function(questions, trees) {
        var self = this;
        questions = questions || [];

        questions.forEach(function(node, idx) {
            if (node.type_constraint === 'facility') {
                trees[node.id] = new FacilityTree(
                        parseFloat(node.logic.nlat),
                        parseFloat(node.logic.wlng),
                        parseFloat(node.logic.slat),
                        parseFloat(node.logic.elng),
                        surveyDB,
                        node.id
                        );
            }

            if (node.sub_surveys) {
                node.sub_surveys.forEach(function(subs) {
                    self.buildTrees(subs.nodes, trees);
                });
            }
        });
    },

    /*
     * Load next question, updates state of the Application
     * if next question is not found move to either SPLASH/SUBMIT
     *
     * Deals with branching, required and setting up dontknow footer state
     * Uses refs! (Could be removed)
     */
    onNextButton: function() {
        var self = this;
        var surveyID = this.props.survey.id;
        var currentState = this.state.state;
        var currentQuestion = this.state.question;

        // Set up next state
        var nextQuestion = null;
        var showDontKnow = false;
        var showDontKnowBox = false;
        var state = this.state.states.SPLASH;
        var head = this.state.head;
        var headStack = this.state.headStack;

        console.log('Current Question', currentQuestion);

        switch(currentState) {
            // On Submit page and next was pressed
            case this.state.states.SUBMIT:
                nextQuestion = null;
                showDontKnow = false;
                showDontKnowBox = false;
                state = this.state.states.SPLASH
                //XXX Fire Modal for submitting here
                this.onSave();

                // Reset Survey Linked List
                head = this.state.headStack[0] || head;
                while(head.prev) {
                    head = head.prev;
                };
                headStack = [];
                break;

            // On Splash page and next was pressed
            case this.state.states.SPLASH:
                nextQuestion = this.state.head;
                showDontKnow = nextQuestion.allow_dont_know || false;
                showDontKnowBox = false;
                state = this.state.states.QUESTION

                var questionID = nextQuestion.id;
                if (showDontKnow) {
                    var response = this.refs.footer.getAnswer(questionID);
                    console.log('Footer response:', response);
                    showDontKnowBox = Boolean(response);
                }

                break;

            case this.state.states.QUESTION:
                // Look into active answers, check if any filled out if question is REQUIRED
                var required = currentQuestion.required || false;
                if (required) {
                    var questionID = currentQuestion.id;
                    var survey = JSON.parse(localStorage[surveyID] || '{}');
                    var answers = (survey[questionID] || []).filter(function(response) {
                        return (response && response.response !== null);
                    });

                    if (!answers.length) {
                        alert('Valid response is required.');
                        return;
                    }
                }

                // Get answer
                var questionID = currentQuestion.id;
                var survey = JSON.parse(localStorage[surveyID] || '{}');
                var answers = (survey[questionID] || []).filter(function(response) {
                    return (response && response.response !== null);
                });

                // XXX Confirm response type is answer (instead of dont-know/other)
                var answer = answers.length && answers[0].response || null;
                var sub_surveys = currentQuestion.sub_surveys;

                // If has subsurveys then it can branch
                if (sub_surveys) {
                    console.log('Subsurveys:', currentQuestion.id, sub_surveys);
                    console.log('Answer:', answer);

                    // Check which subsurvey this answer buckets into
                    var BREAK = false;
                    sub_surveys.forEach(function(sub) {
                        if (BREAK) {return;}
                        console.log('Bucket:', sub.buckets, 'Type:', currentQuestion.type_constraint);

                        // Append all subsurveys to clone of current question, update head, update headStack if in bucket
                        var inBee = self.inBucket(sub.buckets, currentQuestion.type_constraint, answer);
                        if (inBee) {
                            // Clone current element
                            var clone = self.cloneNode(currentQuestion);
                            var temp = clone.next;

                            // link sub nodes
                            // TODO: Deal with repeatable flag here!
                            // XXX: When adding repeat questions make sure to augment the question.id in a repeatable and unique way
                            // XXX: QuestionIDs are used to distinguish/remember questions everywhere, do not reuse IDs!
                            for (var i = 0; i < sub.nodes.length; i++) {
                                if (i == 0) {
                                    clone.next = sub.nodes[i];
                                    sub.nodes[i].prev = clone;
                                } else {
                                    sub.nodes[i].prev = sub.nodes[i - 1];;
                                }

                                if (i === sub.nodes.length - 1) {
                                    sub.nodes[i].next = temp;
                                    if (temp)
                                        temp.prev = sub.nodes[i];
                                } else {
                                    sub.nodes[i].next = sub.nodes[i + 1];
                                }
                            }

                            // Always add branchable questions previous state into headStack
                            // This is how we can revert alterations to a branched question
                            headStack.push(currentQuestion);

                            // Find the head
                            var newHead = clone;
                            while(newHead.prev) {
                                newHead = newHead.prev;
                            }
                            head = newHead;

                            // Set current question to CLONE always
                            currentQuestion = clone;

                            BREAK = true;// break
                        }

                    });

                }

                nextQuestion = currentQuestion.next;
                state = this.state.states.QUESTION

                // Set the state to SUBMIT when reach the end of questions
                if (nextQuestion === null) {
                    nextQuestion = currentQuestion; //Keep track of tail
                    showDontKnow = false;
                    showDontKnowBox = false;
                    state = this.state.states.SUBMIT;
                    break;
                }

                // Moving into a valid question
                showDontKnow = nextQuestion.allow_dont_know || false;
                showDontKnowBox = false;
                var questionID = nextQuestion.id;

                if (showDontKnow) {
                    var response = this.refs.footer.getAnswer(questionID);
                    console.log('Footer response:', response);
                    showDontKnowBox = Boolean(response);
                }

                break;

        }

        this.setState({
            question: nextQuestion,
            showDontKnow: showDontKnow,
            showDontKnowBox: showDontKnowBox,
            head: head,
            headStack: headStack,
            state: state
        })

        return;

    },

    /*
     * Load prev question, updates state of the Application
     * if prev question is not found to SPLASH
     */
    onPrevButton: function() {
        var self = this;
        var surveyID = this.props.survey.id;
        var currentState = this.state.state;
        var currentQuestion = this.state.question;

        // Set up next state
        var nextQuestion = null;
        var showDontKnow = false;
        var showDontKnowBox = false;
        var state = this.state.states.SPLASH;
        var head = this.state.head;
        var headStack = this.state.headStack;

        switch(currentState) {
            // On Submit page and prev was pressed
            case this.state.states.SUBMIT:
                nextQuestion = currentQuestion; // Tail was saved in current question

                // Branching ONLY happens when moving BACK into branchable question
                // Rare but can happen on question that either leads to submit or more questions
                var sub_surveys = nextQuestion.sub_surveys;
                if (sub_surveys && headStack.length) {
                    // If he's in the branched stack, pop em off
                    if (headStack[headStack.length - 1].id === nextQuestion.id) {
                        console.log('RESETING', nextQuestion.id, headStack.length);
                        // Reset the nextQuestion to previously unbranched state
                        nextQuestion = headStack.pop();
                        console.log('RESET', nextQuestion.id, headStack.length);
                        // Find the head
                        var newHead = nextQuestion;
                        while(newHead.prev) {
                            newHead = newHead.prev;
                        }
                        head = newHead;
                    }
                }


                showDontKnow = currentQuestion.allow_dont_know || false;
                showDontKnowBox = false;
                state = this.state.states.QUESTION

                var questionID = currentQuestion.id;
                if (showDontKnow) {
                    var response = this.refs.footer.getAnswer(questionID);
                    console.log('Footer response:', response);
                    showDontKnowBox = Boolean(response);
                }
                break;

            // On Splash page and prev was pressed (IMPOSSIBLE)
            case this.state.states.SPLASH:
                nextQuestion = null;
                showDontKnowBox = false;
                showDontKnow = false;
                state = this.state.states.SPLASH
                break;

            case this.state.states.QUESTION:
                nextQuestion = currentQuestion.prev;
                state = this.state.states.QUESTION

                // Set the state to SUBMIT when reach the end of questions
                if (nextQuestion === null) {
                    nextQuestion = currentQuestion;
                    showDontKnow = false;
                    showDontKnowBox = false;
                    state = this.state.states.SPLASH;
                    break;
                }

                // Branching ONLY happens when moving BACK into branchable question
                // ALWAYS undo branched state to maintain survey consitency
                var sub_surveys = nextQuestion.sub_surveys;
                if (sub_surveys && headStack.length) {
                    // If he's in the branched stack, pop em off
                    if (headStack[headStack.length - 1].id === nextQuestion.id) {
                        console.log('RESETING', nextQuestion.id, headStack.length);
                        // Reset the nextQuestion to previously unbranched state
                        nextQuestion = headStack.pop();
                        console.log('RESET', nextQuestion.id, headStack.length);
                        // Find the head
                        var newHead = nextQuestion;
                        while(newHead.prev) {
                            newHead = newHead.prev;
                        }
                        head = newHead;
                    }
                }


                // Moving into a valid question
                showDontKnow = nextQuestion.allow_dont_know || false;
                showDontKnowBox = false;
                var questionID = nextQuestion.id;

                if (showDontKnow) {
                    var response = this.refs.footer.getAnswer(questionID);
                    console.log('Footer response:', response);
                    showDontKnowBox = Boolean(response);
                }

                break;

        }

        this.setState({
            question: nextQuestion,
            showDontKnow: showDontKnow,
            showDontKnowBox: showDontKnowBox,
            head: head,
            headStack: headStack,
            state: state
        })

        return;

    },

    /*
     * Check if response is in bucket
     *
     * @buckets: Array of buckets (can be ranges in [num,num) form or 'qid' for mc
     * @type: type of bucket
     * @resposne: answer to check if in bucket
     */
    inBucket: function(buckets, type, response) {
        if (response === null)
            return false;

        switch(type) {
            case 'integer':
            case 'decimal':
                var inBee = 1; // Innocent untill proven guilty
                // Split bucket into four sections, confirm that value in range, otherwise set inBee to false
                var BREAK = false;
                buckets.forEach(function(bucket) {
                    if (BREAK) {return;}
                    inBee = 1;
                    var left = bucket.split(',')[0];
                    var right = bucket.split(',')[1];
                    if (left[0] === '[') {
                        var leftLim = parseFloat(left.split('[')[1]);
                        console.log('Inclusive Left', leftLim);
                        if (!isNaN(leftLim)) // Infinity doesnt need to be checked
                            inBee &= (response >= leftLim);
                    } else if (left[0] === '(') {
                        var leftLim = parseFloat(left.split('(')[1]);
                        console.log('Exclusive Left', leftLim);
                        if (!isNaN(leftLim)) // Infinity doesnt need to be checked
                            inBee &= (response > leftLim)
                    } else {
                        inBee = 0;
                    }

                    if (right[right.length - 1] === ']') {
                        var rightLim = parseFloat(right.split(']')[0]);
                        console.log('Inclusive Right', rightLim);
                        if (!isNaN(rightLim)) // Infinity doesnt need to be checked
                            inBee &= (response <= rightLim)
                    } else if (right[right.length - 1] === ')') {
                        var rightLim = parseFloat(right.split(')')[0]);
                        console.log('Exclusive Right', rightLim);
                        if (!isNaN(rightLim)) // Infinity doesnt need to be checked
                            inBee &= (response < rightLim)
                    } else {
                        inBee = 0; // unknown
                    }

                    console.log('Bucket:', bucket, response, inBee);
                    if (inBee) {
                        BREAK = true; //break
                    }

                });

                return inBee;

	    case 'timestamp': // TODO: We need moment.js for this to work properly
            case 'date':
                var inBee = 1; // Innocent untill proven guilty
                response = new Date(response); // Convert to date object for comparisons
                var BREAK = false;
                buckets.forEach(function(bucket) {
                    inBee = 1;
                    if (BREAK) {return;}
                    var left = bucket.split(',')[0];
                    var right = bucket.split(',')[1];
                    if (left[0] === '[') {
                        console.log('Inclusive Left');
                        var leftLim = new Date(left.split('[')[1].replace(/\s/, 'T'));
                        if (!isNaN(leftLim)) // Infinity doesnt need to be checked
                            inBee &= (response >= leftLim);
                    } else if (left[0] === '(') {
                        console.log('Exclusive Left');
                        var leftLim = new Date(left.split('(')[1].replace(/\s/, 'T'));
                        if (!isNaN(leftLim)) // Infinity doesnt need to be checked
                            inBee &= (response > leftLim)
                    } else {
                        inBee = 0;
                    }

                    if (right[right.length - 1] === ']') {
                        console.log('Inclusive Right');
                        var rightLim = new Date(right.split(']')[0].replace(/\s/, 'T'));
                        if (!isNaN(rightLim)) // Infinity doesnt need to be checked
                            inBee &= (response <= rightLim)
                    } else if (right[right.length - 1] === ')') {
                        console.log('Exclusive Right');
                        var rightLim = new Date(right.split(')')[0].replace(/\s/, 'T'));
                        if (!isNaN(rightLim)) // Infinity doesnt need to be checked
                            inBee &= (response < rightLim)
                    } else {
                        inBee = 0; // unknown
                    }

                    console.log('Bucket:', bucket, response, inBee);
                    if (inBee) {
                        BREAK = true; //break
                    }

                    return true;
                });

                return inBee;
            case 'multiple_choice':
                var inBee = 0;
                buckets.forEach(function(bucket) {
                    inBee |= (bucket === response);
                    console.log('Bucket:', bucket, response, inBee);
                });
                return inBee;
            default:
                return false;

        }
    },

    /*
     * Clone linked list node, arrays don't need to be cloned, only next/prev ptrs
     * @node: Current node to clone
     * @ids: Dictionay reference of currently cloned nodes, prevents recursion going on forever
     */
    cloneNode: function(node, ids) {
        var self = this;
        var clone = {
            next: null,
            prev: null
        };

        ids = ids || {};

        Object.keys(node).forEach(function(key) {
            if (key != 'next' && key != 'prev') {
                clone[key] = node[key]
            }
        });

       // Mutable so next/prev pointers will be visible to all nodes that reference this dictionary
       ids[node.id] = clone;

       if (node.next) {
           var next = ids[node.next.id];
           clone.next = next || self.cloneNode(node.next, ids);
       }

       if (node.prev) {
           var prev = ids[node.prev.id];
           clone.prev = prev || self.cloneNode(node.prev, ids);
       }

        return clone;
    },

    /*
     * Save active survey into unsynced array
     */
    onSave: function() {
        var survey = JSON.parse(localStorage[this.props.survey.id] || '{}');
        // Get all unsynced surveys
        var unsynced_surveys = JSON.parse(localStorage['unsynced'] || '{}');
        // Get array of unsynced submissions to this survey
        var unsynced_submissions = unsynced_surveys[this.props.survey.id] || [];
        // Get array of unsynced photo id's
        var unsynced_photos = JSON.parse(localStorage['unsynced_photos'] || '[]');
        // Get array of unsynced facilities
        var unsynced_facilities = JSON.parse(localStorage['unsynced_facilities'] || '[]');

        // Build new submission
        var answers = [];
        var self = this;

        // Copy active questions into simple list;
        var questions = [];
        var head = this.state.head;
        while(head) {
            questions.push(head);
            head = head.next;
        }

        questions.forEach(function(question) {
            var responses = survey[question.id] || [];
            responses.forEach(function(response) {
                // Ignore empty responses
                if (!response || response.response === null) {
                    return true; // continue;
                }

                // Photos need to synced independantly from survey
                if (question.type_constraint === 'photo') {
                   unsynced_photos.push({
                       'surveyID': self.props.survey.id,
                       'photoID': response.response,
                       'questionID': question.id
                   });
                }

                // New facilities need to be stored seperatly from survey
                if (question.type_constraint === 'facility') {
                    if (response.metadata && response.metadata.is_new) {
                        console.log('Facility:', response);
                        self.state.trees[question.id]
                            .addFacility(response.response.lat, response.response.lng, response.response);

                        unsynced_facilities.push({
                            'surveyID': self.props.survey.id,
                            'facilityData': response.response,
                            'questionID': question.id
                        });
                    }
                }

                answers.push({
                    survey_node_id: question.id,
                    response: response,
                    type_constraint: question.type_constraint
                });
            });

        });

        // Don't record it if there are no answers, will mess up splash
        if (answers.length === 0) {
            return;
        }

        var submission = {
            submitter_name: localStorage['submitter_name'] || 'anon',
            submitter_email: localStorage['submitter_email'] || 'anon@anon.org',
            submission_type: 'unauthenticated', //XXX
            survey_id: this.props.survey.id,
            answers: answers,
            save_time: new Date().toISOString(),
            submission_time: '' // For comparisions during submit ajax callback
        }

        console.log('Submission', submission);

        // Record new submission into array
        unsynced_submissions.push(submission);
        unsynced_surveys[this.props.survey.id] = unsynced_submissions;
        localStorage['unsynced'] = JSON.stringify(unsynced_surveys);

        // Store photos
        localStorage['unsynced_photos'] = JSON.stringify(unsynced_photos);

        // Store facilities
        localStorage['unsynced_facilities'] = JSON.stringify(unsynced_facilities);

        // Wipe active survey
        localStorage[this.props.survey.id] = JSON.stringify({});

        // Wipe location info
        localStorage['location'] = JSON.stringify({});

    },

    /*
     * Loop through unsynced submissions for active survey and POST
     * Only modifies localStorage on success
     */
    onSubmit: function() {
        function getCookie(name) {
            var r = document.cookie.match('\\b' + name + '=([^;]*)\\b');
            return r ? r[1] : undefined;
        }

        var self = this;

        // Get all unsynced surveys
        var unsynced_surveys = JSON.parse(localStorage['unsynced'] || '{}');
        // Get array of unsynced submissions to this survey
        var unsynced_submissions = unsynced_surveys[this.props.survey.id] || [];
        // Get all unsynced photos.
        var unsynced_photos = JSON.parse(localStorage['unsynced_photos'] || '[]');
        // Get all unsynced facilities
        var unsynced_facilities = JSON.parse(localStorage['unsynced_facilities'] || '[]');

        // Post surveys to Dokomoforms
        unsynced_submissions.forEach(function(survey) {
            // Update submit time
            survey.submission_time = new Date().toISOString();
            $.ajax({
                url: '/api/v0/surveys/'+survey.survey_id+'/submit',
                type: 'POST',
                contentType: 'application/json',
                processData: false,
                data: JSON.stringify(survey),
                headers: {
                    'X-XSRFToken': getCookie('_xsrf')
                },
                dataType: 'json',
                success: function(survey, anything, hey) {
                    console.log('success', anything, hey);
                    // Get all unsynced surveys
                    var unsynced_surveys = JSON.parse(localStorage['unsynced'] || '{}');
                    // Get array of unsynced submissions to this survey
                    var unsynced_submissions = unsynced_surveys[survey.survey_id] || [];

                    // Find unsynced_submission
                    var idx = -1;
                    unsynced_submissions.forEach(function(usurvey, i) {
                        if (Date(usurvey.save_time) === Date(survey.save_time)) {
                            idx = i;
                        }
                    });

                    // Not sure what happened, do not update localStorage
                    if (idx === -1)
                        return;

                    unsynced_submissions.splice(idx, 1);

                    unsynced_surveys[survey.survey_id] = unsynced_submissions;
                    localStorage['unsynced'] = JSON.stringify(unsynced_surveys);

                    // Update splash page if still on it
                    if (self.state.state === self.state.states.SPLASH)
                        self.refs.splash.update();
                },

                error: function(err) {
                    console.log('Failed to post survey', err, survey);
                }
            });

            console.log('synced submission:', survey);
            console.log('survey', '/api/v0/surveys/'+survey.survey_id+'/submit');
        });

        // Post photos to dokomoforms
        unsynced_photos.forEach(function(photo, idx) {
            if (photo.surveyID === self.props.survey.id) {
                PhotoAPI.getBase64(self.state.db, photo.photoID, function(err, base64){
                    $.ajax({
                        url: '/api/v0/photos',
                        type: 'POST',
                        contentType: 'application/json',
                        processData: false,
                        data: JSON.stringify({
                            'id' : photo.photoID,
                            'mime_type': 'image/png',
                            'image': base64
                        }),
                        headers: {
                            'X-XSRFToken': getCookie('_xsrf')
                        },
                        dataType: 'json',
                        success: function(photo) {
                            console.log('Photo success:', photo);
                            var unsynced_photos = JSON.parse(localStorage['unsynced_photos'] || '[]');
                            // Find photo
                            var idx = -1;
                            unsynced_photos.forEach(function(uphoto, i) {
                                if (uphoto.photoID === photo.id) {
                                    idx = i;
                                    PhotoAPI.removePhoto(self.state.db, uphoto.photoID, function(err, result) {
                                        if (err) {
                                            console.log('Couldnt remove from db:', err);
                                            return;
                                        }
                                        console.log('Removed:', result);
                                    });
                                }
                            });

                            // What??
                            if (idx === -1)
                                return;

                            console.log(idx, unsynced_photos.length);
                            unsynced_photos.splice(idx, 1);

                            localStorage['unsynced_photos'] = JSON.stringify(unsynced_photos);
                        },

                        error: function(err) {
                            console.log('Failed to post photo:', err, photo);
                        }
                    });
                });
            }
        });

        // Post facilities to Revisit
        unsynced_facilities.forEach(function(facility, idx) {
            if (facility.surveyID === self.props.survey.id) {
                self.state.trees[facility.questionID].postFacility(facility.facilityData,
                    // Success
                    function(revisitFacility) {
                        console.log('Successfully posted facility', revisitFacility, facility);
                        var unsynced_facilities = JSON.parse(localStorage['unsynced_facilities'] || '[]');

                        // Find facility
                        var idx = -1;
                        console.log(idx, unsynced_facilities.length);
                        unsynced_facilities.forEach(function(ufacility, i) {
                            var ufacilityID = ufacility.facilityData.facility_id;
                            var facilityID = facility.facilityData.facility_id;
                            if (ufacilityID === facilityID) {
                                idx = i;
                            }
                        });

                        // What??
                        if (idx === -1)
                            return;

                        console.log(idx, unsynced_facilities.length);
                        unsynced_facilities.splice(idx, 1);

                        localStorage['unsynced_facilities'] = JSON.stringify(unsynced_facilities);
                    },

                    // Error
                    function(revisitFacility) {
                        console.log('Failed to post facility', err, facility);
                    }
                );
            }
        });
    },


    /*
     * Respond to don't know checkbox event, this is listend to by Application
     * due to app needing to resize for the increased height of the don't know
     * region
     */
    onCheckButton: function() {
        this.setState({
            showDontKnowBox: this.state.showDontKnowBox ? false: true,
            showDontKnow: this.state.showDontKnow,
        });

        // Force questions to update
        if (this.state.state = this.state.states.QUESTION)
            this.refs.question.update();

    },

    /*
     * Load the appropiate question based on the nextQuestion state
     * Loads splash or submit content if state is either SPLASH/SUBMIT
     */
    getContent: function() {
        var question = this.state.question;
        var state = this.state.state;
        var survey = this.props.survey;

        if (state === this.state.states.QUESTION) {
            var questionID = question.id;
            var questionType = question.type_constraint;
            switch(questionType) {
                case 'multiple_choice':
                    return (
                            React.createElement(MultipleChoice, {
                                ref: "question", 
                                key: questionID, 
                                question: question, 
                                questionType: questionType, 
                                language: survey.default_language, 
                                surveyID: survey.id, 
                                disabled: this.state.showDontKnowBox}
                           )
                       )
                case 'photo':
                    return (
                            React.createElement(Photo, {
                                ref: "question", 
                                key: questionID, 
                                question: question, 
                                questionType: questionType, 
                                language: survey.default_language, 
                                surveyID: survey.id, 
                                disabled: this.state.showDontKnowBox, 
                                db: this.state.db}
                           )
                       )

                case 'location':
                    return (
                            React.createElement(Location, {
                                ref: "question", 
                                key: questionID, 
                                question: question, 
                                questionType: questionType, 
                                language: survey.default_language, 
                                surveyID: survey.id, 
                                disabled: this.state.showDontKnowBox}
                           )
                       )
                case 'facility':
                    return (
                            React.createElement(Facility, {
                                ref: "question", 
                                key: questionID, 
                                question: question, 
                                questionType: questionType, 
                                language: survey.default_language, 
                                surveyID: survey.id, 
                                disabled: this.state.showDontKnowBox, 
                                db: this.state.db, 
                                tree: this.state.trees[questionID]}
                           )
                       )
                case 'note':
                    return (
                            React.createElement(Note, {
                                ref: "question", 
                                key: questionID, 
                                question: question, 
                                questionType: questionType, 
                                language: survey.default_language, 
                                surveyID: survey.id, 
                                disabled: this.state.showDontKnowBox}
                           )
                       )
                default:
                    return (
                            React.createElement(Question, {
                                ref: "question", 
                                key: questionID, 
                                question: question, 
                                questionType: questionType, 
                                language: survey.default_language, 
                                surveyID: survey.id, 
                                disabled: this.state.showDontKnowBox}
                           )
                       )
            }
        } else if (state === this.state.states.SUBMIT) {
            return (
                    React.createElement(Submit, {
                        ref: "submit", 
                        surveyID: survey.id, 
                        language: survey.default_language}
                    )
                   )
        } else {
            return (
                    React.createElement(Splash, {
                        ref: "splash", 
                        surveyID: survey.id, 
                        surveyTitle: survey.title, 
                        language: survey.default_language, 
                        buttonFunction: this.onSubmit}
                    )
                   )
        }
    },

    /*
     * Load the appropiate title based on the question and state
     */
    getTitle: function() {
        var survey = this.props.survey;
        var question = this.state.question;
        var state = this.state.state;

        if (state === this.state.states.QUESTION) {
            return question.title[survey.default_language]
        } else if (state === this.state.states.SUBMIT) {
            return 'Ready to Save?'
        } else {
            return survey.title[survey.default_language]
        }
    },

    /*
     * Load the appropiate 'hint' based on the question and state
     */
    getMessage: function() {
        var survey = this.props.survey;
        var question = this.state.question;
        var state = this.state.state;

        if (state === this.state.states.QUESTION) {
            return question.hint[survey.default_language]
        } else if (state === this.state.states.SUBMIT) {
            return 'If youre satisfied with the answers to all the questions, you can save the survey now.'
        } else {
            return 'version ' + survey.version + ' | last updated ' + survey.last_updated_time;
        }
    },

    /*
     * Load the appropiate text in the Footer's button based on state
     */
    getButtonText: function() {
        var state = this.state.state;
        if (state === this.state.states.QUESTION) {
            return 'Next Question';
        } else if (state === this.state.states.SUBMIT) {
            return 'Save Survey'
        } else {
            return 'Begin a New Survey'
        }
    },

    render: function() {
        var contentClasses = 'content';
        var state = this.state.state;
        var question = this.state.question;
        var questionID = question && question.id || -1;
        var surveyID = this.props.survey.id;

        // Get current length of survey and question number
        var number = -1;
        var length = 0;
        var head = this.state.head;
        while(head) {
            if (head.id === questionID) {
                number = length;
            }

            head = head.next;
            length++;
        }


        // Alter the height of content based on DontKnow state
        if (this.state.showDontKnow)
            contentClasses += ' content-shrunk';

        if (this.state.showDontKnowBox)
            contentClasses += ' content-shrunk content-super-shrunk';

        return (
                React.createElement("div", {id: "wrapper"}, 
                    React.createElement(Header, {
                        ref: "header", 
                        buttonFunction: this.onPrevButton, 
                        number: number + 1, 
                        total: length + 1, 
                        db: this.state.db, 
                        surveyID: surveyID, 
                        splash: state === this.state.states.SPLASH}), 
                    React.createElement("div", {
                        className: contentClasses}, 
                        React.createElement(Title, {title: this.getTitle(), message: this.getMessage()}), 
                        this.getContent()
                    ), 
                    React.createElement(Footer, {
                        ref: "footer", 
                        showDontKnow: this.state.showDontKnow, 
                        showDontKnowBox: this.state.showDontKnowBox, 
                        buttonFunction: this.onNextButton, 
                        checkBoxFunction: this.onCheckButton, 
                        buttonType: state === this.state.states.QUESTION
                            ? 'btn-primary': 'btn-positive', 
                        buttonText: this.getButtonText(), 
                        questionID: questionID, 
                        surveyID: surveyID}
                     )

                )
               );
    }
});

module.exports = Application;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./api/FacilityAPI":2,"./api/PhotoAPI":3,"./components/Facility":4,"./components/Footer":5,"./components/Header":6,"./components/Location":7,"./components/MultipleChoice":8,"./components/Note":9,"./components/Photo":10,"./components/Question":11,"./components/Splash":12,"./components/Submit":13,"./components/baseComponents/Title":24,"pouchdb-upsert":35,"pouchdb/dist/pouchdb.min":50}],2:[function(require,module,exports){
(function (global){
//XXX set globally on init in application
//var config.revisit_url = 'http://localhost:3000/api/v0/facilities.json';

var $ = (typeof window !== "undefined" ? window['jQuery'] : typeof global !== "undefined" ? global['jQuery'] : null),
    LZString = require('lz-string'),
    Promise = require('mpromise'),
    config = require('../conf/config');

/*
 * FacilityTree class, contains accessors for facilities
 *
 * @nlat: north latitude
 * @slat: south latitude
 * @elng: east longitude
 * @wlng: west longitude
 *
 *
 * All underscore methods are helper methods to do the recursion
 */
var FacilityTree = function(nlat, wlng, slat, elng, db, id) {
    // Ajax request made below node definition
    var self = this;
    this.nlat = nlat;
    this.wlng = wlng;
    this.slat = slat;
    this.elng = elng;
    this.db = db;
    this.id = id;

    /*
     * FacilityNode class, node of the tree, knows how to access pouchDB to read compressed facilities
     *
     * @obj: JSON representation of the node
     */
    var facilityNode = function(obj) {

        // Bounding Box
        this.en = obj.en;
        this.ws = obj.ws;

        this.center = obj.center;
        this.sep = obj.sep;

        // Stats
        this.uncompressedSize = obj.uncompressedSize || 0;
        this.compressedSize = obj.compressedSize || 0;
        this.count = obj.count || 0;

        // Data
        this.isRoot = obj.isRoot;
        this.isLeaf = obj.isLeaf;
        this.children = {};
        if (this.isLeaf && obj.data) {
            this.setFacilities(obj.data);
        }

        // Children
        if (obj.children) {
            if (obj.children.wn)
                this.children.wn = new facilityNode(obj.children.wn);
            if (obj.children.en)
                this.children.en = new facilityNode(obj.children.en);
            if (obj.children.ws)
                this.children.ws = new facilityNode(obj.children.ws);
            if (obj.children.es)
                this.children.es = new facilityNode(obj.children.es);
        }

    };


    facilityNode.prototype.print = function(indent) {
        indent = indent || '';
        var shift = '--';

        console.log(indent + ' Node: ' + this.center[1], this.center[0], this.count);
        if (this.children.wn && this.children.wn.count) {
            console.log(indent + shift + ' NW');
            this.children.wn.print(indent + shift);
        }

        if (this.children.en && this.children.en.count) {
            console.log(indent + shift + ' NE');
            this.children.en.print(indent + shift);
        }

        if (this.children.ws && this.children.ws.count) {
            console.log(indent + shift + ' SW');
            this.children.ws.print(indent + shift);
        }

        if (this.children.es && this.children.es.count)  {
            console.log(indent + shift + ' SE');
            this.children.es.print(indent + shift);
        }

        console.log(indent + '__');
    };

    /*
     * Set the facilities array into pouchDB
     *
     * facilities is a compressed LZString16 bit representation of facilities contained in an one entry array
     */
    facilityNode.prototype.setFacilities = function(facilities) {
        var id = this.en[1]+''+this.ws[0]+''+this.ws[1]+''+this.en[0];
        // Upsert deals with put 409 conflict bs
        db.upsert(id, function(doc) {
            doc.facilities = facilities;
            return doc;
        })
            .then(function () {
                console.log('Set:', id);
            }).catch(function (err) {
                console.log('Failed to Set:', err);
            });
    };

    /*
     * Get facilities for this node
     *
     * returns mpromise style promise that will contain an array of uncompressed facilities
     */
    facilityNode.prototype.getFacilities = function() {
        var id = this.en[1]+''+this.ws[0]+''+this.ws[1]+''+this.en[0];
        var p = new Promise;
        db.get(id).then(function(facilitiesDoc) {
            console.log('Get:', id);
            var facilitiesLZ = facilitiesDoc.facilities[0]; // Why an array? WHO KNOWS
            var facilities = JSON.parse(LZString.decompressFromUTF16(facilitiesLZ));
            p.fulfill(facilities);
        }).catch(function (err) {
            console.log('Failed to Get:', err);
            p.reject();
        });

        return p;
    };

    facilityNode.prototype.within = function(lat, lng) {
        var self = this;
        return ((lat < self.en[1] && lat >= self.ws[1])
               && (lng > self.ws[0] && lng <= self.en[0]));
    };

    facilityNode.prototype.crossesBound = function(nlat, wlng, slat, elng) {
        var self = this;

        if ((nlat < self.ws[1]) || (slat > self.en[1]))
            return false;

        if ((wlng > self.en[0]) || (elng < self.ws[0]))
           return false;

        return true;
    };

    facilityNode.prototype.distance = function(lat, lng) {
        var self = this;
        var R = 6371000; // metres
        var e = self.center[1] * Math.PI/180;
        var f = lat * Math.PI/180;
        var g = (lat - self.center[1]) * Math.PI/180;
        var h = (lng - self.center[0]) * Math.PI/180;

        var a = Math.sin(g/2) * Math.sin(g/2) +
                Math.cos(e) * Math.cos(f) *
                Math.sin(h/2) * Math.sin(h/2);

        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    };

    // Revisit ajax req
    $.ajax({
        url: config.revisit_url,
        data: {
            within: self.nlat + ',' + self.wlng + ',' + self.slat + ',' + self.elng,
            compressed: 'anything can be here',
            //fields: 'name,uuid,coordinates,properties:sector',
        },
        success: function(data) {
            console.log('Recieved Data traversing');
            self.total = data.total;
            self.root = new facilityNode(data.facilities);
            self.storeTree();
        },
        error: function() {
            console.log('Failed to retrieve data, building from local');
            var facilities = self.loadTree();
            if (facilities)
                self.root = new facilityNode(facilities);

        }
    });

    console.log(config.revisit_url, '?within=',
            self.nlat + ',' + self.wlng + ',' + self.slat + ',' + self.elng,
            '&compressed');

};

/* Store facility tree in localStorage without children */
FacilityTree.prototype.storeTree = function() {
    // Data is never stored in object, stringifiying root should be sufficient
    var facilities = JSON.parse(localStorage['facilities'] || '{}');
    facilities[this.id] = this.root;
    localStorage['facilities'] = JSON.stringify(facilities);
};

/* Load facility tree from localStorage */
FacilityTree.prototype.loadTree = function() {
    var facilities = JSON.parse(localStorage['facilities'] || '{}');
    return facilities[this.id];
};


FacilityTree.prototype._getNNode = function(lat, lng, node) {
    var self = this,
        cnode;

    // Maybe I'm a leaf?
    if (node.isLeaf) {
        return node;
    }

    if (node.count > 0) {
        // NW
        if (node.children.wn && node.children.wn.within(lat, lng)) {
            cnode = self._getNNode(lat, lng, node.children.wn);
            if (cnode)
                return cnode;
        }

        // NE
        if (node.children.en && node.children.en.within(lat, lng)) {
            cnode = self._getNNode(lat, lng, node.children.en);
            if (cnode)
                return cnode;
        }

        // SW
        if (node.children.ws && node.children.ws.within(lat, lng)) {
            cnode = self._getNNode(lat, lng, node.children.ws);
            if (cnode)
                return cnode;
        }

        // SE
        if (node.children.es && node.children.es.within(lat, lng)) {
            cnode = self._getNNode(lat, lng, node.children.es);
            if (cnode)
                return cnode;
        }
    }
};

/*
 * Get Nearest node to lat, lng
 */
FacilityTree.prototype.getNNode = function(lat, lng) {
    var self = this;

    if (!self.root.within(lat, lng))
        return null;

    var node = self._getNNode(lat, lng, self.root);
    console.log('node: ', node.center[1], node.center[0], 'distance from center', node.distance(lat,lng));

    return node;
};

FacilityTree.prototype._getRNodes = function(nlat, wlng, slat, elng, node) {
    var self = this;

    // Maybe I'm a leaf?
    if (node.isLeaf) {
        return [node];
    }

    var nodes = [];
    if (node.count > 0) {
        // NW
        if (node.children.wn && node.children.wn.crossesBound(nlat, wlng, slat, elng)) {
            nodes = nodes.concat(self._getRNodes(nlat, wlng, slat, elng, node.children.wn));
        }

        // NE
        if (node.children.en && node.children.en.crossesBound(nlat, wlng, slat, elng)) {
            nodes = nodes.concat(self._getRNodes(nlat, wlng, slat, elng, node.children.en));
        }

        // SW
        if (node.children.ws && node.children.ws.crossesBound(nlat, wlng, slat, elng)) {
            nodes = nodes.concat(self._getRNodes(nlat, wlng, slat, elng, node.children.ws));
        }

        // SE
        if (node.children.es && node.children.es.crossesBound(nlat, wlng, slat, elng)) {
            nodes = nodes.concat(self._getRNodes(nlat, wlng, slat, elng, node.children.es));
        }
    }

    return nodes;
};

/*
 * Get all nodes that cross the box defined by nlat, wlng, slat, elng
 */
FacilityTree.prototype.getRNodesBox = function(nlat, wlng, slat, elng) {
    var self = this;

    if (!self.root.crossesBound(nlat, wlng, slat, elng))
        return null;

    var nodes = self._getRNodes(nlat, wlng, slat, elng, self.root);
    return nodes;
};

/*
 * Get all nodes that cross the circle defined by lat, lng and radius r
 */
FacilityTree.prototype.getRNodesRad = function(lat, lng, r) {
    var self = this;

    var R = 6378137;
    var dlat = r/R;
    var dlng = r/(R*Math.cos(Math.PI*lat/180));

    var nlat = lat + dlat * 180/Math.PI;
    var wlng = lng - dlng * 180/Math.PI;
    var slat = lat - dlat * 180/Math.PI;
    var elng = lng + dlng * 180/Math.PI;

    if (!self.root.crossesBound(nlat, wlng, slat, elng))
        return null;

    var nodes = self._getRNodes(nlat, wlng, slat, elng, self.root);
    return nodes;
};

/*
 * Returns a promise with n nearest sorted facilities
 * pouchDB forces the async virus to spread to all getFacilities function calls :(
 *
 * XXX: Basically the only function that matters
 */
FacilityTree.prototype.getNNearestFacilities = function(lat, lng, r, n) {
    var self = this;
    var p = new Promise; // Sorted facilities promise

    // Calculates meter distance between facilities and center of node
    function dist(coordinates, clat, clng) {
        var lat = coordinates[1];
        var lng = coordinates[0];

        var R = 6371000;
        var e = clat * Math.PI/180;
        var f = lat * Math.PI/180;
        var g = (lat - clat) * Math.PI/180;
        var h = (lng - clng) * Math.PI/180;

        var a = Math.sin(g/2) * Math.sin(g/2) +
               Math.cos(e) * Math.cos(f) *
               Math.sin(h/2) * Math.sin(h/2);

        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // Sort X Nodes Data
    var nodes = self.getRNodesRad(lat, lng, r);
    var nodeFacilities = []; // Each Pouch promise writes into here
    var nodeFacilitiesPromise = new Promise; //Pouch db retrival and sorting promise

    // Merge X Nodes Sorted Data AFTER promise resolves (read this second)
    nodeFacilitiesPromise.onResolve(function() {
        var facilities = [];
        while(n > 0 && nodeFacilities.length > 0) {
            nodeFacilities = nodeFacilities.filter(function(facilities) {
                return facilities.length;
            });

            var tops = [];
            nodeFacilities.forEach(function(facilities, idx) {
                tops.push({'fac': facilities[0], 'idx': idx});
            });

            tops.sort(function (nodeA, nodeB) {
                var lengthA = dist(nodeA.fac.coordinates, lat, lng);
                var lengthB = dist(nodeB.fac.coordinates, lat, lng);
                return (lengthA - lengthB);
            });

            //XXX: Should terminate early if this is the case instead
            if (tops.length > 0)
                facilities.push(nodeFacilities[tops[0].idx].shift());

            n--;
        }

        // Append distance to each facility
        facilities.forEach(function(facility) {
            facility.distance = dist(facility.coordinates, lat, lng);
        });

        return p.fulfill(facilities);
    });

    // Sort each nodes facilities (read this first)
    nodes.forEach(function(node, idx) {
        node.getFacilities().onResolve(function(err, facilities) {
            facilities.sort(function (facilityA, facilityB) {
                var lengthA = dist(facilityA.coordinates, lat, lng);
                var lengthB = dist(facilityB.coordinates, lat, lng);
                return (lengthA - lengthB);
            });

            nodeFacilities.push(facilities);
            console.log('Current facilities length', nodeFacilities.length, nodes.length);
            if (nodeFacilities.length === nodes.length) {
                nodeFacilitiesPromise.fulfill();
            }
        });
    });


    return p;
};

FacilityTree.prototype.print = function() {
    this.root.print();
};


FacilityTree.prototype._getLeaves = function(node) {
    var self = this;

    // Check if this is a leaf
    if (node.isLeaf)
        return [node];

    // Otherwise check all children
    var nodes = [];
    if (node.count > 0) {
        // NW
        if (node.children.wn)
            nodes = nodes.concat(self._getLeaves(node.children.wn));

        // NE
        if (node.children.en)
            nodes = nodes.concat(self._getLeaves(node.children.en));

        // SW
        if (node.children.ws)
            nodes = nodes.concat(self._getLeaves(node.children.ws));

        // SE
        if (node.children.es)
            nodes = nodes.concat(self._getLeaves(node.children.es));
    }

    return nodes;
};

/*
 * Return all leaf nodes of the facility
 * ie. any node with isLeaf flag set to true
 */
FacilityTree.prototype.getLeaves = function() {
    var self = this;
    return self._getLeaves(self.root);
};

/*
 * Helper method to calculate compressed size
 * (Sums up values in all leaves)
 */
FacilityTree.prototype.getCompressedSize = function() {
    var self = this;
    var leaves = self._getLeaves(self.root);
    return leaves.reduce(function(sum, node) {
        return node.compressedSize + sum;
    }, 0);
};

/*
 * Helper method to calculate uncompressed size
 * (Sums up values in all leaves)
 */
FacilityTree.prototype.getUncompressedSize = function() {
    var self = this;
    var leaves = self._getLeaves(self.root);
    return leaves.reduce(function(sum, node) {
        return node.uncompressedSize + sum;
    }, 0);
};

/*
 * Helper method to calculate total facility count
 * (Sums up values in all leaves)
 */
FacilityTree.prototype.getCount = function() {
    var self = this;
    var leaves = self._getLeaves(self.root);
    return leaves.reduce(function(sum, node) {
        return node.count + sum;
    }, 0);
};

/*
 * Helper method for transforming facility data into Revisit format
 *
 * @facilityData: Facility data in dokomoforms submission form
 */
FacilityTree.prototype.formatFacility = function(facilityData) {
    var facility = {};
    facility.uuid = facilityData.facility_id;
    facility.name = facilityData.facility_name;
    facility.properties = {sector: facilityData.facility_sector};
    facility.coordinates = [facilityData.lng, facilityData.lat];
    return facility;
};

/*
 * Adds a facility to local copy of facilityTree
 *
 * @lat, lng: location to add facility
 * @facilityData: Facility information to add into tree
 * @formatted: if facilityData is already in correct format (will be converted if not set)
 */
FacilityTree.prototype.addFacility = function(lat, lng, facilityData, formatted) {
    var self = this;
    var leaf = self.getNNode(lat, lng);

    formatted = Boolean(formatted) || false;
    console.log('formatted?', formatted);
    var facility = formatted ? facilityData : self.formattedFacility(facilityData);

    console.log('Before', leaf.count, leaf.uncompressedSize, leaf.compressedSize);
    leaf.getFacilities().onResolve(function(err, facilities) {
        if (err) {
            console.log('Failed to add facility', err);
            return;
        }

        console.log('Got facilities:', facilities.length);
        facilities.push(facility);
        var facilitiesStr = JSON.stringify(facilities);
        var facilitiesLZ = [LZString.compressToUTF16(facilitiesStr)]; // mongoose_quadtree does this in [] for a reason i do not remember
        leaf.setFacilities(facilitiesLZ);

        leaf.count++;
        leaf.uncompressedSize = facilitiesStr.length || 0;
        leaf.compressedSize = facilitiesLZ.length || 0;
        console.log('After', leaf.count, leaf.uncompressedSize, leaf.compressedSize);

    });
};

/*
 * Post facility to Revisit
 *
 * @facilityData: Facility information to send to revisit
 * @successCB: What to do on succesful post
 * @errorCB: What to do on unsuccesful post
 * @formatted: if facilityData is already in correct format (will be converted if not set)
 */
FacilityTree.prototype.postFacility = function(facilityData, successCB, errorCB, formatted) {
    var self = this;

    formatted = Boolean(formatted) || false;
    console.log('formatted?', formatted);
    var facility = formatted ? facilityData : self.formattedFacility(facilityData);

    $.ajax({
        url: config.revisit_url,
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(facility),
        processData: false,
        dataType: 'json',
        success: successCB,

        headers: {
            'Authorization': 'Basic ' + btoa('dokomoforms' + ':' + 'password')
             //XXX Obsecure basic auth in bundlejs somehow? Force https after?
        },

        error: errorCB,
    });
};

/*
 * Compute lat lng distance from center {lat, lng}
 *
 * XXX function is copied in a few places with mild alterations, prob should be merged
 */
FacilityTree.prototype.distance = function(lat, lng, center) {
    var self = this;
    var R = 6371000; // metres
    var e = center.lat * Math.PI/180;
    var f = lat * Math.PI/180;
    var g = (lat - center.lat) * Math.PI/180;
    var h = (lng - center.lng) * Math.PI/180;

    var a = Math.sin(g/2) * Math.sin(g/2) +
            Math.cos(e) * Math.cos(f) *
            Math.sin(h/2) * Math.sin(h/2);

    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
};

//Nigeria
//var nlat = 8;
//var wlng = -8;
//var slat = -22;
//var elng = 40;

// NYC
//var nlat = 85;
//var wlng = -72;
//var slat = -85
//var elng = -74;

// World
//var nlat = 85;
//var wlng = -180;
//var slat = -85;
//var elng = 180;

//window.tree = tree;
//var tree = new FacilityTree(nlat, wlng, slat, elng);
//var nyc = {lat: 40.80690, lng:-73.96536}
//window.nyc = nyc;

//tree.getCompressedSize() / 1048576
//tree.getNNearestFacilities(7.353078, 5.118915, 500, 10)
//tree.getNNearestFacilities(40.80690, -73.96536, 500, 10)
//tree.getCompressedSize()/tree.getUncompressedSize()
//tree.getRNodesRad(40.80690, -73.96536, 500)

module.exports = FacilityTree;


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"../conf/config":25,"lz-string":32,"mpromise":33}],3:[function(require,module,exports){
module.exports = {
    /*
     * Get photo with uuid, id from pouchDB as data URI
     */
    getPhoto: function(db, id, callback) {
        db.getAttachment(id, 'photo').then(function(photo) {
            callback(null, URL.createObjectURL(photo));
        }).catch(function(err) {
            callback(err);
        });
    },

    /*
     * Get photo with uuid, id from pouchDB as base64 string
     */
    getBase64: function(db, id, callback) {
        db.getAttachment(id, 'photo').then(function(photoBlob) {
            var reader = new window.FileReader();
            reader.readAsDataURL(photoBlob);
            reader.onloadend = function() {
                var photoURI = reader.result;
                var photo64 = photoURI.substring(photoURI.indexOf(',')+1);
                callback(null, photo64);
            };
        }).catch(function(err) {
            callback(err);
        });
    },

    /*
     * Get photo with uuid, id from pouchDB as blob
     */
    getBlob: function(db, id, callback) {
        db.getAttachment(id, 'photo').then(function(photo) {
            callback(null, photo);
        }).catch(function(err) {
            callback(err);
        });
    },

    /*
     * Remove photo with uuid, id from pouchDB
     */
    removePhoto: function(db, photoID, callback) {
        db.get(photoID).then(function (photoDoc) {
            db.removeAttachment(photoID, 'photo', photoDoc._rev)
                .then(function(result) {
                    db.remove(photoID, result.rev);
                    callback(null, result);
                }).catch(function(err) {
                    callback(err);
                });
        });
    },

    /*
     * Add photo with given uuid and base64 URI to pouchDB
     * TODO set up callback
     */
    addPhoto: function(db, photoID, photo, callback) {
        var photo64 = photo.substring(photo.indexOf(',')+1);
        console.log(photo);
        console.log(photoID);
        db.put({
            '_id': photoID,
            '_attachments': {
                'photo': {
                    'content_type': 'image/png',
                    'data': photo64
                }
            }
        });

    }

};

},{}],4:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);
var Promise = require('mpromise');

var ResponseField = require('./baseComponents/ResponseField.js');
var LittleButton = require('./baseComponents/LittleButton.js');

var FacilityRadios = require('./baseComponents/FacilityRadios.js');
var Select = require('./baseComponents/Select.js');

/*
 * Facilities question component
 *
 * props:
 *     @question: node object from survey
 *     @questionType: type constraint
 *     @language: current survey language
 *     @surveyID: current survey id
 *     @disabled: boolean for disabling all inputs
 *     @db: pouchdb database
 *     @tree: Facility Tree object
 */
module.exports = React.createClass({displayName: "exports",
    getInitialState: function() {
        var answer = this.getAnswer();
        var selectOff = answer && answer.metadata && answer.metadata.is_new;
        return {
            loc: null,
            selectFacility: !selectOff,
            facilities: [],
            choices: [
                {'value': 'water', 'text': 'Water'},
                {'value': 'energy', 'text': 'Energy'},
                {'value': 'education', 'text': 'Education'},
                {'value': 'health', 'text': 'Health'}
            ]
        };
    },

    /*
     * Deal with async call to getFacilities
     */
    componentWillMount: function() {
        var loc = JSON.parse(localStorage['location'] || '{}');
        var self = this;
        self.getFacilities(loc).onResolve(function(err, facilities) {
            self.setState({
                loc: loc,
                facilities: facilities
            });
        });
    },
    /*
     * Hack to force react to update child components
     * Gets called by parent element through 'refs' when state of something changed
     * (usually localStorage)
     */
    update: function() {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length === 0 ? 1 : answers.length;
        this.setState({
            questionCount: length
        });
    },

    /*
     * Switch view to new Facility View
     */
    toggleAddFacility: function() {
        this.setState({
            selectFacility : this.state.selectFacility ? false : true
        });
    },

    /*
     * Record newly chosen facility into localStorage
     *
     * @option: The facility uuid chosen
     * @data: I have no idea why i have this?
     */
    selectFacility: function(option, data) {
        console.log("Selected facility");
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        answers = [];

        this.state.facilities.forEach(function(facility) {
            if (facility.uuid === option) {
                answers = [{
                    'response': {
                        'facility_id': facility.uuid,
                        'facility_name': facility.name,
                        'facility_sector': facility.properties.sector,
                        'lat': facility.coordinates[1],
                        'lng': facility.coordinates[0]
                    },
                    'response_type': 'answer'
                }];
                return false;
            }
            return true;
        });

        survey[this.props.question.id] = answers;
        localStorage[this.props.surveyID] = JSON.stringify(survey);

    },

    /*
     * Query the tree for nearby facilities near given location when possible
     *
     * @loc: The location ({lat: NUM, lng: NUM}) to query around
     */
    getFacilities: function(loc) {
        if (!loc || !loc.lat || !loc.lng || !this.props.tree || !this.props.tree.root) {
            var p = new Promise;
            p.fulfill([]);
            return p;
        }

        console.log("Getting facilities ...");
        return this.props.tree.getNNearestFacilities(loc.lat, loc.lng, 1000, 10);
    },

    /*
     * Get response from localStorage
     */
    getAnswer: function() {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        console.log("Selected facility", answers[0]);
        if (answers[0]) return answers[0];
    },

    /*
     * Generate objectID compatitable with Mongo for the Revisit API
     *
     * Returns an objectID string
     */
    createObjectID: function() {
        return 'xxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[x]/g, function() {
            var r = Math.random()*16|0;
            return r.toString(16);
        });
    },

    /*
     * Deal with all new facility input fields, type is bound to function call
     *
     * @type: Type of input that was updated
     * @value: newly supplied input
     */
    onInput: function(type, value) {
        console.log("Dealing with input", value, type);
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var self = this;
        if (answers[0] && (!answers[0].metadata || !answers[0].metadata.is_new)) {
            answers = [];
        }

        // Load up previous response, update values
        var response = (answers[0] && answers[0].response) || {};
        var uuid = response.facility_id || this.createObjectID();
        response.facility_id = uuid;
        // XXX This kind of assumes that current lat/lng is correct at the time of last field update
        response.lat = this.state.loc.lat;
        response.lng = this.state.loc.lng;

        switch(type) {
            case 'text':
                response.facility_name = value;
                break;
            case 'select':
                var v = value[0]; // Only one ever
                console.log('Selected v', v);
                response.facility_sector = v;
                break;
            case 'other':
                console.log('Other v', value);
                response.facility_sector = value;
                break;
        }

        //XXX Failed validation messes up facility question
        //TODO: Properly handle null values

        answers = [{
            'response': response,
            'response_type': 'answer',
            'metadata': {
                'is_new': true
            }
        }];

        console.log("Built response", answers);

        survey[this.props.question.id] = answers;
        localStorage[this.props.surveyID] = JSON.stringify(survey);
    },


    /*
     * Retrieve location and record into state on success.
     */
    onLocate: function() {
        var self = this;
        navigator.geolocation.getCurrentPosition(
            function success(position) {
                var loc = {
                    'lat': position.coords.latitude,
                    'lng': position.coords.longitude,
                }

                // Record location for survey
                localStorage['location'] = JSON.stringify(loc);

                self.getFacilities(loc).onResolve(function(err, facilities) {
                    self.setState({
                        loc: loc,
                        facilities: facilities
                    });
                });
            },

            function error() {
                console.log("Location could not be grabbed");
            },

            {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 0
            }
        );


    },

    render: function() {
        // Retrieve respone for initValues
        var answer = this.getAnswer();
        var choiceOptions = this.state.choices.map(function(choice) { return choice.value });

        var hasLocation = this.state.loc && this.state.loc.lat && this.state.loc.lng;
        var isNew = answer && answer.metadata && answer.metadata.is_new;

        // Update sector field to match initSelect expected value
        var sector = answer && answer.response.facility_sector;
        var isOther = choiceOptions.indexOf(sector) === -1;
        sector = isOther ? sector && 'other' : sector;

        return (
                React.createElement("span", null, 
                this.state.selectFacility ?
                    React.createElement("span", null, 
                    React.createElement(LittleButton, {buttonFunction: this.onLocate, 
                        icon: 'icon-star', 
                        text: 'find my location and show nearby facilities', 
                        disabled: this.props.disabled}
                    ), 

                    React.createElement(FacilityRadios, {
                        key: this.props.disabled, 
                        selectFunction: this.selectFacility, 
                        facilities: this.state.facilities, 
                        initValue: answer && !isNew && answer.response.facility_id, 
                        disabled: this.props.disabled}
                    ), 

                     hasLocation  ?
                        React.createElement(LittleButton, {buttonFunction: this.toggleAddFacility, 
                            disabled: this.props.disabled, 
                            text: 'add new facility'}
                        )
                        : null
                    
                    )
                :
                    React.createElement("span", null, 
                    React.createElement(ResponseField, {
                        onInput: this.onInput.bind(null, 'text'), 
                        initValue: isNew && answer.response.facility_name, 
                        type: 'text', 
                        disabled: this.props.disabled}
                    ), 
                    React.createElement(ResponseField, {
                        initValue: JSON.stringify(this.state.loc), 
                        type: 'location', 
                        disabled: true}
                    ), 
                    React.createElement(Select, {
                        choices: this.state.choices, 
                        initValue: isNew && isOther ? answer.response.facility_sector : null, 
                        initSelect: isNew && [sector], 
                        withOther: true, 
                        multiSelect: false, 
                        onInput: this.onInput.bind(null, 'other'), 
                        onSelect: this.onInput.bind(null, 'select'), 
                        disabled: this.props.disabled}
                    ), 

                    React.createElement(LittleButton, {
                        buttonFunction: this.toggleAddFacility, 
                            text: 'cancel', 
                            disabled: this.props.disabled}
                     )

                    )
                
                )
               )
    }
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./baseComponents/FacilityRadios.js":17,"./baseComponents/LittleButton.js":18,"./baseComponents/ResponseField.js":22,"./baseComponents/Select.js":23,"mpromise":33}],5:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null); 
var BigButton = require('./baseComponents/BigButton.js');
var DontKnow = require('./baseComponents/DontKnow.js');
var ResponseField = require('./baseComponents/ResponseField.js'); 

/*
 * Footer component
 * Render footer containing a button and possible DontKnow component
 *
 * props:
 *  @showDontKnow: Boolean to activate DontKnow component
 *  @checkBoxFunction: What do on DontKnow component click event
 *  @buttonText: Text to show on big button
 *  @buttonType: Type of big button to render
 *  @showDontKnowBox: Boolean to extend footer and show input field
 *  @questionID: id of active question (if any)
 *  @surveyID: id of active survey
 */
module.exports = React.createClass({displayName: "exports",
    getDontKnow: function() {
        if (this.props.showDontKnow)
            return (React.createElement(DontKnow, {
                        checkBoxFunction: this.onCheck, 
                        key: this.props.questionID, 
                        checked: this.props.showDontKnowBox}
                    ))

        return null;
    },

    /*
     * Record new response into localStorage, response has been validated
     * if this callback is fired 
     */
    onInput: function(value, index) {

        console.log("Hey", index, value);
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');

        answers = [{
            'response': value, 
            'response_type': 'dont_know'
        }];

        survey[this.props.questionID] = answers;
        localStorage[this.props.surveyID] = JSON.stringify(survey);

    },

    /*
     * Clear localStorage when dont know is checked
     * Call checkBoxFunction if supplied
     *
     * @event: click event on checkbox
     */ 
    onCheck: function(event) {
        // Clear responses
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        survey[this.props.questionID] = [];
        localStorage[this.props.surveyID] = JSON.stringify(survey);

        if (this.props.checkBoxFunction) {
            this.props.checkBoxFunction(event);
        }
    },

    /*
     * Get default value for an input at a given index from localStorage
     */
    getAnswer: function(questionID) {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[questionID] || [];
        return answers[0] && answers[0].response_type === 'dont_know' && answers[0].response || null;
    },


    render: function() {
        var FooterClasses = "bar bar-standard bar-footer";
        if (this.props.showDontKnow) 
            FooterClasses += " bar-footer-extended";
        if (this.props.showDontKnowBox) 
            FooterClasses += " bar-footer-extended bar-footer-super-extended";

        var self = this;
        return (
                React.createElement("div", {className: FooterClasses}, 
                    React.createElement(BigButton, {text: this.props.buttonText, 
                    type: this.props.buttonType, 
                    buttonFunction: this.props.buttonFunction}), 
                     this.getDontKnow(), 
                     this.props.showDontKnowBox ? 
                        React.createElement(ResponseField, {
                                index: 0, 
                                onInput: self.onInput, 
                                initValue: self.getAnswer(self.props.questionID), 
                                type: 'text'}
                        ) 
                    : null
                )
               )
    }
});



}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./baseComponents/BigButton.js":14,"./baseComponents/DontKnow.js":16,"./baseComponents/ResponseField.js":22}],6:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);
var Menu = require('./baseComponents/Menu.js');

/*
 * Header component
 * Displays the top bar of the Application, includes hambaagah menu
 *
 * props:
 *  @splash: Boolean to render splash header instead of the default
 *  @buttonFunction: What to do on previous button click
 *  @number: Current number to render in header
 *  @db: Active pouch db // XXX rather not pass this to header
 *  @surveyID: active surveyID
 */
module.exports = React.createClass({displayName: "exports",
    getInitialState: function() {
        return { showMenu: false }
    },

    onClick: function() {
        this.setState({showMenu: this.state.showMenu ? false : true })
    },

    render: function() {
        var headerClasses = "bar bar-nav bar-padded noselect";
        if (this.state.showMenu) 
            headerClasses += " title-extended";

        return (
            React.createElement("header", {className: headerClasses}, 
            this.props.splash ?
                React.createElement("h1", {className: "title align-left"}, "independant")
             :   
                React.createElement("span", null, 
                React.createElement("button", {onClick: this.props.buttonFunction, 
                    className: "btn btn-link btn-nav pull-left page_nav__prev"}, 
                    React.createElement("span", {className: "icon icon-left-nav"}), " ", React.createElement("span", {className: ""}, "Previous")
                ), 
                React.createElement("h1", {className: "title"}, this.props.number, " / ", this.props.total)
                ), 
            

            React.createElement("a", {className: "icon icon-bars pull-right menu", onClick: this.onClick}), 

             this.state.showMenu ? React.createElement(Menu, {surveyID: this.props.surveyID, db: this.props.db}) : null
            )
        )
    }

});



}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./baseComponents/Menu.js":19}],7:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);

var ResponseField = require('./baseComponents/ResponseField.js');
var LittleButton = require('./baseComponents/LittleButton.js');

/*
 * Location question component
 *
 * props:
 *     @question: node object from survey
 *     @questionType: type constraint
 *     @language: current survey language
 *     @surveyID: current survey id
 *     @disabled: boolean for disabling all inputs
 */
module.exports = React.createClass({displayName: "exports",
    getInitialState: function() {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length === 0 ? 1 : answers.length;

        return { 
            questionCount: length,
        }
    },

    /*
     * Hack to force react to update child components
     * Gets called by parent element through 'refs' when state of something changed 
     * (usually localStorage)
     */
    update: function() {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length === 0 ? 1 : answers.length;
        this.setState({
            questionCount: length,
        });
    },

    /*
     * Add new input if and only if they've responded to all previous inputs
     */
    addNewInput: function() {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length;

        console.log("Length:", length, "Count", this.state.questionCount);
        if (answers[length] && answers[length].response_type
                || length > 0 && length == this.state.questionCount) {

            this.setState({
                questionCount: this.state.questionCount + 1
            })
        }
    },

    /*
     * Remove input and update localStorage
     */
    removeInput: function(index) {
        console.log("Remove", index);

        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length;

        answers.splice(index, 1);
        survey[this.props.question.id] = answers;

        localStorage[this.props.surveyID] = JSON.stringify(survey);


        var count = this.state.questionCount;
        if (this.state.questionCount > 1)
            count = count - 1;

        this.setState({
            questionCount: count
        })

        this.forceUpdate();
    },

    /*
     * Retrieve location and record into localStorage on success.
     * Updates questionCount on success, triggering rerender of page
     * causing input fields to have values reloaded.
     *
     * Only updates the LAST active input field.
     */
    onLocate: function() {
        var self = this;
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var index = answers.length === 0 ? 0 : this.refs[answers.length] ? answers.length : answers.length - 1; // So sorry

        navigator.geolocation.getCurrentPosition(
            function success(position) {
                var loc = {
                    'lat': position.coords.latitude,
                    'lng': position.coords.longitude, 
                }

                // Record location for survey
                localStorage['location'] = JSON.stringify(loc);

                answers[index] = {
                    'response': loc, 
                    'response_type': 'answer'
                };

                survey[self.props.question.id] = answers; // Update localstorage
                localStorage[self.props.surveyID] = JSON.stringify(survey);

                var length = answers.length === 0 ? 1 : answers.length;
                self.setState({
                    questionCount: length
                });
            }, 
            
            function error() {
                console.log("Location could not be grabbed");
            }, 
            
            {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 0
            }
        );


    },

    /*
     * Get default value for an input at a given index from localStorage
     *
     * @index: The location in the answer array in localStorage to search
     */
    getAnswer: function(index) {
        console.log("In:", index);

        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length === 0 ? 1 : answers.length;

        console.log(answers, index);
        return answers[index] && JSON.stringify(answers[index].response) || null;
    },

    render: function() {
        var children = Array.apply(null, {length: this.state.questionCount})
        var self = this;
        return (
                React.createElement("span", null, 
                React.createElement(LittleButton, {
                    buttonFunction: this.onLocate, 
                    iconClass: 'icon-star', 
                    text: 'find my location'}
                ), 
                children.map(function(child, idx) {
                    return (
                            React.createElement(ResponseField, {
                                buttonFunction: self.removeInput, 
                                type: self.props.questionType, 
                                key: Math.random(), 
                                index: idx, 
                                ref: idx, 
                                disabled: true, 
                                initValue: self.getAnswer(idx), 
                                showMinus: true}
                            )
                           )
                }), 
                this.props.question.allow_multiple
                    ? React.createElement(LittleButton, {buttonFunction: this.addNewInput, 
                        disabled: this.props.disabled, 
                        text: 'add another answer'})
                    : null
                
                )
               )
    }
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./baseComponents/LittleButton.js":18,"./baseComponents/ResponseField.js":22}],8:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);
var Select = require('./baseComponents/Select.js');

/*
 * Multiple choice question component
 *
 * props:
 *     @question: node object from survey
 *     @questionType: type constraint
 *     @language: current survey language
 *     @surveyID: current survey id
 *     @disabled: boolean for disabling all inputs
 */
module.exports = React.createClass({displayName: "exports",
    getInitialState: function() {
        return { 
        }
    },

    /*
     * Hack to force react to update child components
     * Gets called by parent element through 'refs' when state of something changed 
     * (usually localStorage)
     */
    update: function() {
    },

    /*
     * Record all selected options into localStorage
     */
    onSelect: function(values) {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        answers = [];
        values.forEach(function(value, index) {
            if (value == 'null')
                return;
            answers.push({
                'response': value === 'other' ? '' : value, 
                'response_type': value === 'other' ? 'other' : 'answer'
            });
        });

        console.log("values", values, answers)
        survey[this.props.question.id] = answers;
        localStorage[this.props.surveyID] = JSON.stringify(survey);

    },

    /*
     * Record other response into existing slot of answer object in localStorage
     * Callback is only called on validated input
     */
    onInput: function(value) {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];

        answers.forEach(function(answer, index) {
            if (answer.response_type === 'other') {
                answer.response = value;
                return false;
            }
            return true;
        });

        survey[this.props.question.id] = answers;
        localStorage[this.props.surveyID] = JSON.stringify(survey);

    },

    /*
     * Get all selected options from localStorage
     */
    getSelection: function() {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];

        var values = [];
        answers.forEach(function(answer, index) {
            values[index] = answer.response;
            if (answer.response_type === 'other')
                values[index] = 'other';
        });

        console.log("values", values)
        return values;
    },

    /*
     * Get other response if any from localStorage 
     */
    getAnswer: function() {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];

        var response = null;
        answers.forEach(function(answer, index) {
            if (answer.response_type === 'other') {
                response = answer.response;
                return false;
            }

            return true;
        });

        console.log("response", response);
        return response;
    },
    
    render: function() {
        var self = this;
        var choices = this.props.question.choices.map(function(choice) {
            return { 
                'value': choice.choice_id, 
                'text': choice.choice_text[self.props.language] 
            }
        });

        // Key is used as hack to rerender select on dontKnow state change
        return (React.createElement(Select, {
                    key: this.props.disabled, 
                    choices: choices, 
                    withOther: this.props.question.allow_other, 
                    multiSelect: this.props.question.allow_multiple, 
                    disabled: this.props.disabled, 
                    initValue: this.getAnswer(), 
                    initSelect: this.getSelection(), 
                    onSelect: this.onSelect, 
                    onInput: this.onInput}
                ))
    }
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./baseComponents/Select.js":23}],9:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);

/*
 * Note component
 *
 * props:
 *     @question: node object from survey
 *     @questionType: type constraint
 *     @language: current survey language
 *     @surveyID: current survey id
 */
module.exports = React.createClass({displayName: "exports",
    // Every question component needs this method
    update: function() {
    },

    render: function() {
        return (
                React.createElement("span", null)
               )
    }
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],10:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null),
    PhotoField = require('./baseComponents/PhotoField'),
    LittleButton = require('./baseComponents/LittleButton'),
    PhotoAPI = require('../api/PhotoAPI'),
    uuid = require('node-uuid');

//XXX use this: navigator.vibrate(50);

/*
 * Location question component
 *
 * props:
 *     @question: node object from survey
 *     @questionType: type constraint
 *     @language: current survey language
 *     @surveyID: current survey id
 *     @disabled: boolean for disabling all inputs
 *     @db: pouchdb database
 */
module.exports = React.createClass({displayName: "exports",
    getInitialState: function() {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length ? answers.length : 1;

        var camera = null;
        var src = null;

        return {
            questionCount: length,
            requested: false,
            camera: camera,
            photos: [],
            src: src
        };
    },

    // This is how you react to the render call back. Once video is mounted I can attach a source
    // and re-render the page with it using the autoPlay feature. No DOM manipulation required!!
    componentDidMount: function() {
        this.getStream();
        this.getPhotos();
    },

    componentWillMount: function() {
    },

    getStream: function() {
        var self = this;
        // Browser implementations
        navigator.getUserMedia = navigator.getUserMedia ||
            navigator.webkitGetUserMedia ||
            navigator.mozGetUserMedia ||
            navigator.msGetUserMedia;

        navigator.getUserMedia ({
            video: {optional: [{sourceId: self.state.camera}]}
        }, function(stream) {
            var src = window.URL.createObjectURL(stream);
            console.log(src);
            self.setState({
                src: src
            });
        }, function(err) {
            console.log("Video failed:", err);
        });

    },

    /*
     * Get default value for an input at a given index from localStorage
     * Use this value to query pouchDB and update state asynchronously
     */
    getPhotos: function() {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var self = this;

        answers.forEach(function(answer, idx) {
            PhotoAPI.getPhoto(self.props.db, answer.response, function(err, photo) {
                if (err) {
                    console.log("DB query failed:", err);
                    return;
                }

                self.state.photos[idx] = photo;
                self.setState({
                    photos: self.state.photos
                });
            });
        });
    },

    /*
     * Hack to force react to update child components
     * Gets called by parent element through 'refs' when state of something changed
     * (usually localStorage)
     */
    update: function() {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length;
        this.setState({
            questionCount: length,
        });
    },

    /*
     * Add new input if and only if they've responded to all previous inputs
     */
    addNewInput: function() {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length;

        console.log("Length:", length, "Count", this.state.questionCount);
        if (answers[length] && answers[length].response_type
                || length > 0 && length == this.state.questionCount) {

            this.setState({
                questionCount: this.state.questionCount + 1
            })
        }
    },

    /*
     * Remove input and update localStorage
     */
    removeInput: function(index) {
        console.log("Remove", index);

        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length;
        var photoID = answers[index] && answers[index].response || 0;
        var self = this;

        // Removing an empty input
        if (photoID === 0) {
            return;
        }

        // Remove from localStorage;
        answers.splice(index, 1);
        survey[this.props.question.id] = answers;
        localStorage[this.props.surveyID] = JSON.stringify(survey);

        // Remove from pouchDB
        console.log("removing", photoID);
        this.state.photos.splice(index, 1);
        PhotoAPI.removePhoto(this.props.db, photoID, function(err, result) {
            if (err) {
                console.log("Could not remove attachment?:", err);
                return;
            }
            console.log("Removed attachement:", result);
        });

        var count = this.state.questionCount - 1;
        count = count ? count : 1;
        this.setState({
            photos: this.state.photos,
            questionCount: count
        })
    },

    /*
     * Retrieve location and record into localStorage on success.
     * Updates questionCount on success, triggering rerender of page
     * causing input fields to have values reloaded.
     *
     * Only updates the LAST active input field.
     */
    onCapture: function() {
        var self = this;
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var index = answers.length === 0 ? 0 : this.refs[answers.length] ? answers.length : answers.length - 1; // So sorry

        // Capture still from video element and write into new canvas
        //XXX Delete canvas? canvas;
        var canvas = document.createElement('canvas');
        var video = React.findDOMNode(this.refs.video);
        canvas.height = video.clientHeight;
        canvas.width = video.clientWidth;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Extract photo from canvas and write it into pouchDB
        var photo = canvas.toDataURL('image/png');
        var photoID = uuid.v4();
        PhotoAPI.addPhoto(this.props.db, photoID, photo)

        // Record the ID into localStorage
        answers[index] = {
            'response': photoID,
            'response_type': 'answer'
        };

        survey[self.props.question.id] = answers; // Update localstorage
        localStorage[self.props.surveyID] = JSON.stringify(survey);

        // Update state for count and in memory photos array
        var length = answers.length === 0 ? 1 : answers.length;
        self.state.photos[index] = photo;
        self.setState({
            photos: self.state.photos,
            questionCount: length
        });

    },

    render: function() {
        var children = Array.apply(null, {length: this.state.questionCount})
        var self = this;
        return (
                React.createElement("span", null, 
                React.createElement(LittleButton, {
                    buttonFunction: this.onCapture, 
                    disabled: this.props.disabled, 
                    iconClass: 'icon-star', 
                    text: 'take a photo'}
                ), 

                React.createElement("canvas", {ref: "canvas", className: "question__canvas"}), 
                React.createElement("video", {
                    autoPlay: true, 
                    ref: "video", 
                    className: "question__video", 
                    src: this.state.src}
                ), 

                children.map(function(child, idx) {
                    return (
                            React.createElement(PhotoField, {
                                buttonFunction: self.removeInput, 
                                type: self.props.questionType, 
                                key: Math.random(), 
                                index: idx, 
                                ref: idx, 
                                disabled: true, 
                                initValue: self.state.photos[idx], 
                                showMinus: true}
                            )
                           )
                }), 

                this.props.question.allow_multiple
                    ? React.createElement(LittleButton, {buttonFunction: this.addNewInput, 
                        disabled: this.props.disabled, 
                        text: 'add another answer'})
                    : null
                
                )
               )
    }
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"../api/PhotoAPI":3,"./baseComponents/LittleButton":18,"./baseComponents/PhotoField":21,"node-uuid":34}],11:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);

var ResponseField = require('./baseComponents/ResponseField.js');
var LittleButton = require('./baseComponents/LittleButton.js');

/*
 * Question component
 * The default question controller-view
 *
 * props:
 *     @question: node object from survey
 *     @questionType: type constraint
 *     @language: current survey language
 *     @surveyID: current survey id
 *     @disabled: boolean for disabling all inputs
 */
module.exports = React.createClass({displayName: "exports",
    getInitialState: function() {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length === 0 ? 1 : answers.length;

        return { 
            questionCount: length,
        }
    },

    /*
     * Hack to force react to update child components
     * Gets called by parent element through 'refs' when state of something changed 
     * (usually localStorage)
     */
    update: function() {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length === 0 ? 1 : answers.length;
        this.setState({
            questionCount: length,
        });
    },

    /*
     * Add new input if and only if they've responded to all previous inputs
     */
    addNewInput: function() {
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length;

        console.log("Length:", length, "Count", this.state.questionCount);
        if (answers[length] && answers[length].response_type
                || length > 0 && length == this.state.questionCount) {

            this.setState({
                questionCount: this.state.questionCount + 1
            })
        }
    },

    /*
     * Remove input and update localStorage
     */
    removeInput: function(index) {
        console.log("Remove", index);

        if (!(this.state.questionCount > 1))
            return;

        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length === 0 ? 1 : answers.length;

        answers.splice(index, 1);
        survey[this.props.question.id] = answers;

        localStorage[this.props.surveyID] = JSON.stringify(survey);

        this.setState({
            questionCount: this.state.questionCount - 1
        })

        //this.forceUpdate();
    },

    /*
     * Record new response into localStorage, response has been validated
     * if this callback is fired 
     */
    onInput: function(value, index) {

        console.log("Hey", index, value);
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length === 0 ? 1 : answers.length;

        //XXX Null value implies failed validation
        answers[index] = {
            'response': value, 
            'response_type': 'answer'
        };

        survey[this.props.question.id] = answers;
        localStorage[this.props.surveyID] = JSON.stringify(survey);

        //if (value === null) {
        //    this.removeInput(index);
        //}
    },

    /*
     * Get default value for an input at a given index from localStorage
     *
     * @index: The location in the answer array in localStorage to search
     */
    getAnswer: function(index) {
        console.log("In:", index);

        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var answers = survey[this.props.question.id] || [];
        var length = answers.length === 0 ? 1 : answers.length;

        console.log(answers, index);
        return answers[index] && answers[index].response || null;
    },

    render: function() {
        var children = Array.apply(null, {length: this.state.questionCount})
        var self = this;
        return (
                React.createElement("span", null, 
                children.map(function(child, idx) {
                    return (
                            React.createElement(ResponseField, {
                                buttonFunction: self.removeInput, 
                                onInput: self.onInput, 
                                type: self.props.questionType, 
                                logic: self.props.question.logic, 
                                key: Math.random(), 
                                index: idx, 
                                disabled: self.props.disabled, 
                                initValue: self.getAnswer(idx), 
                                showMinus: self.state.questionCount > 1}
                            )
                           )
                }), 
                this.props.question.allow_multiple
                    ? React.createElement(LittleButton, {buttonFunction: this.addNewInput, 
                        disabled: this.props.disabled, 
                        text: 'add another answer'})
                    : null
                
                )
               )
    }
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./baseComponents/LittleButton.js":18,"./baseComponents/ResponseField.js":22}],12:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);

var Card = require('./baseComponents/Card.js');
var BigButton = require('./baseComponents/BigButton.js');

/*
 * Splash page component
 * Renders the appropiate card for the main page
 *
 * props:
 *     @language: current survey language
 *     @surveyID: current survey id
 *     @buttonFunction: What to do when submit is clicked
 */
module.exports = React.createClass({displayName: "exports",
    getInitialState: function() {
        var self = this;
        // Get all unsynced surveys
        var unsynced_surveys = JSON.parse(localStorage['unsynced'] || '{}');
        // Get array of unsynced submissions to this survey
        var unsynced_submissions = unsynced_surveys[this.props.surveyID] || [];

        // Update navigator.onLine
        var interval = window.setInterval(function() {
            if (self.state.online !== navigator.onLine) {
                self.setState({
                    online: navigator.onLine,
                });
            }
        }, 1000);

        return { 
            count: unsynced_submissions.length,
            online: navigator.onLine,
            interval: interval,
        }
    },

    // Force react to update
    update: function() {
        // Get all unsynced surveys
        var unsynced_surveys = JSON.parse(localStorage['unsynced'] || '{}');
        // Get array of unsynced submissions to this survey
        var unsynced_submissions = unsynced_surveys[this.props.surveyID] || [];

        this.setState({ 
            count: unsynced_submissions.length,
            online: navigator.onLine,
        });
    },

    buttonFunction: function(event) {
        if (this.props.buttonFunction)
            this.props.buttonFunction(event);

        // Get all unsynced surveys
        var unsynced_surveys = JSON.parse(localStorage['unsynced'] || '{}');
        // Get array of unsynced submissions to this survey
        var unsynced_submissions = unsynced_surveys[this.props.surveyID] || [];

        this.setState({ 
            count: unsynced_submissions.length,
            online: navigator.onLine,
        });

    },

    componentWillUnmount: function() {
       window.clearInterval(this.state.interval);
    },

    getCard: function() {
        var email = localStorage['submitter_email'] || "anon@anon.org";
        var title = this.props.surveyTitle[this.props.language];
        if (this.state.count) {
            if (this.state.online) {
                // Unsynced and online
                return (
                        React.createElement("span", null, 
                        React.createElement(Card, {messages: [['You have ',  React.createElement("b", null, this.state.count), ' unsynced surveys.', ' Please submit them now.'], 
                            ], type: "message-warning"}), 
                        React.createElement(BigButton, {text: "Submit Completed Surveys", buttonFunction: this.buttonFunction})
                        )
                       )
            } else {
                // Unsynced and offline
                return (
                        React.createElement(Card, {messages: [['You have ',  React.createElement("b", null, this.state.count), ' unsynced surveys.'], 
                            '',
                            'At present, you do not have a network connection — please remember to submit' 
                                + ' these surveys the next time you do have access to the internet.'
                        ], type: "message-warning"})
                       )
            }
        } else {
            // No unsynced surveys
            return (
                    React.createElement(Card, {messages: [['Hi ', React.createElement("b", null, email), ' and welcome to the ', {title}, React.createElement("br", null)], 
                        ['If you have any questions regarding the survey, please ', React.createElement("u", null, "contact the survey adminstrator")]], 
                    type: "message-primary"})
                   )
        }
    },

    render: function() {
        return this.getCard()
    }
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./baseComponents/BigButton.js":14,"./baseComponents/Card.js":15}],13:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);
var Card = require('./baseComponents/Card.js');
var Message = require('./baseComponents/Message.js');
var ResponseField = require('./baseComponents/ResponseField.js');

/*
 * Submit page component
 * Renders the appropiate card and buttons for the submit page
 *
 * props:
 *     @language: current survey language
 *     @surveyID: current survey id
 */
module.exports = React.createClass({displayName: "exports",
    getInitialState: function() {
        return { 
        }
    },

    onInput: function(value, index) {
        if (index === 0) {
            localStorage['submitter_name'] = value;
        } else {
            localStorage['submitter_email'] = value;
        }

    },

    render: function() {
        var self = this;
        return (
                React.createElement("span", null, 
                
                React.createElement(Message, {text: 'Enter your name and email id'}), 
                React.createElement(ResponseField, {
                    onInput: self.onInput, 
                    type: 'text', 
                    key: 'name', 
                    placeholder: "Enumerator Name", 
                    index: 0, 
                    initValue: localStorage['submitter_name'], 
                    showMinus: false}
                ), 

                React.createElement(ResponseField, {
                    onInput: self.onInput, 
                    type: 'email', 
                    key: 'email', 
                    placeholder: "Enumerator Email", 
                    index: 1, 
                    initValue: localStorage['submitter_email'], 
                    showMinus: false}
                ), 

                React.createElement(Card, {messages: ["Saved surveys must be uploaded when you next have network connectivity."], 
                    type: "message-primary"})

                )
               )
    }
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./baseComponents/Card.js":15,"./baseComponents/Message.js":20,"./baseComponents/ResponseField.js":22}],14:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);

/*
 * Big 'ol button
 *
 * props:
 *  @type: Type of button (class name from ratchet usually) defaults to btn-primary
 *  @buttonFunction: What to do on click events
 *  @text: Text of the button
 */
module.exports = React.createClass({displayName: "exports",
    render: function() {
        var buttonClasses = 'btn btn-block navigate-right page_nav__next';
        if (this.props.type) {
            buttonClasses += ' ' + this.props.type;
        } else {
            buttonClasses += ' btn-primary';
        }

        return (
                React.createElement("div", {className: "bar-padded"}, 
                    React.createElement("button", {onClick: this.props.buttonFunction, className: buttonClasses}, 
                        this.props.text
                    )
                )
               );
    }
});



}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],15:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);

/*
 * Card component
 *
 * props:
 *  @type: Card type (class name from ratchet usually) defaults to message-primary
 *  @msg: Array of messages, each element is placed on a new line. JSX accepted
 */
module.exports = React.createClass({displayName: "exports",
    render: function() {
        var messageClass = 'message-box';
        if (this.props.type) {
            messageClass += ' ' + this.props.type;
        } else {
            messageClass += ' message-primary';
        }

        return (
            React.createElement("div", {className: "content-padded"}, 
                React.createElement("div", {className: messageClass}, 
                this.props.messages.map(function(msg, idx) {
                    return (
                            React.createElement("span", null, " ", msg, " ", React.createElement("br", null), " ")
                        );
                })
                )
            )
       );
    }
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],16:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);

/*
 * Don't know component
 *
 * props:
 *  @checkBoxFunction: What to do on click event
 */
module.exports = React.createClass({displayName: "exports",
    render: function() {
        return (
                React.createElement("div", {className: "question__btn__other"}, 
                    React.createElement("input", {
                        onClick: this.props.checkBoxFunction, 
                        type: "checkbox", 
                        id: "dont-know", 
                        name: "dont-know", 
                        defaultChecked: this.props.checked}
                    ), 
                    React.createElement("label", {htmlFor: "dont-know"}, "I don't know the answer")
                )
               );
    }
});



}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],17:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);

/*
 * Facility Radio component
 * Renders radio's specifically formatted for facility data
 *
 * props:
 *  @facilities: Array of facility objects (revisit format)
 *  @selectFunction: What to do when facility is selected
 *  @initValue: Default selected facility
 */
module.exports = React.createClass({displayName: "exports",
    /*
     * Keep track of which option is selected
     */
    getInitialState: function() {
        return {
            selected: this.props.initValue
        };
    },

    /*
     * Make radio behave like single option checkbox
     *
     * Calls selectFunction with option (passes null when option unchecked)
     *
     * @e: click event
     */
    onClick: function(e) {
        var option = e.target.value;
        var checked = e.target.checked;
        var selected = option;

        if (option === this.state.selected) {
            selected = null;
            checked = false;
        }

        e.target.checked = checked;
        window.etarget = e.target;
        //e.stopPropagation();
        //e.cancelBubble = true;

        if (this.props.selectFunction)
            this.props.selectFunction(selected);

        this.setState({
            selected: selected
        });
    },

    render: function() {
        var self = this;
        return (
                React.createElement("div", {className: "question__radios"}, 
                this.props.facilities.map(function(facility) {
                    return (
                        React.createElement("div", {
                            key: facility.uuid, 
                            className: "question__radio noselect"
                        }, 
                            React.createElement("input", {
                                type: "radio", 
                                id: facility.uuid, 
                                name: "facility", 
                                onClick: self.onClick, 
                                disabled: self.props.disabled, 
                                defaultChecked: facility.uuid === self.state.selected, 
                                value: facility.uuid}
                            ), 
                            React.createElement("label", {
                                htmlFor: facility.uuid, 
                                className: "question__radio__label"
                            }, 
                                React.createElement("span", {className: "radio__span"}, 
                                    React.createElement("span", null)
                                ), 
                                React.createElement("strong", {className: "question__radio__strong__meta"}, 
                                    facility.name
                                ), 
                                React.createElement("br", null), 
                                React.createElement("span", {className: "question__radio__span__meta"}, 
                                    facility.properties.sector
                                ), 
                                React.createElement("span", {className: "question__radio__span__meta"}, 
                                    React.createElement("em", null, facility.distance && facility.distance.toFixed(2), "m")
                                )
                            )
                        )
                    );
                })
                )
               );
    }
});



}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],18:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);

/*
 * Little weeny button
 *
 * props:
 *  @type: Type of button (class name from ratchet usually) defaults to btn-primary
 *  @buttonFunction: What to do on click events
 *  @text: Text of the button
 *  @icon: Icon if any to show before button text
 */
module.exports = React.createClass({displayName: "exports",
    render: function() {
        var iconClass = 'icon ' + this.props.icon;
        return (
                React.createElement("div", {className: "content-padded"}, 
                    React.createElement("button", {className: "btn", 
                        disabled: this.props.disabled, 
                        onClick: this.props.buttonFunction}, 

                        this.props.icon ? React.createElement("span", {className: iconClass}) : null, 
                        this.props.text
                    )
                )
               );
    }
});



}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],19:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null),
    PhotoAPI = require('../../api/PhotoAPI.js');

/*
 * Header Menu component
 *
 * XXX In works, must sort out way to properly clear active survey
 * (Could have active survey data that references photos in pouchdb that would
 * be left orphaned if not submitted).
 *
 * @db: active pouch db
 * @surveyID: active surveyID
 */
module.exports = React.createClass({displayName: "exports",

    wipeActive: function() {
        // Confirm their intent
        var nuke = confirm('Warning: Active survey and photos will be lost.');
        if (!nuke)
            return;

        var self = this;
        var survey = JSON.parse(localStorage[this.props.surveyID] || '{}');
        var questionIDs = Object.keys(survey);
        console.log('questionIDs', questionIDs);
        questionIDs.forEach(function(questionID) {
            var responses = survey[questionID] || [];
            console.log('responses', responses);
            responses.forEach(function(response) {
                console.log('response', response);
                //XXX response object does not contain type_constraint, would need to pass in question nodes
                //if (response.type_constraint === 'photo') {
                //XXX hack for now
                if (response.response.length === 36) {
                    PhotoAPI.removePhoto(self.props.db, response.response, function(err, result) {
                        if (err) {
                            //XXX should fail often as it tries to clear every response
                            console.log('Couldnt remove from db:', err);
                            return;
                        }

                        console.log('Removed:', result);
                    });
                }
            });
        });

        // Wipe active survey
        localStorage[this.props.surveyID] = JSON.stringify({});
        // Wipe location info
        localStorage['location'] = JSON.stringify({});
        window.location.reload();
    },


    wipeAll: function() {
        var self = this;
        // Confirm their intent
        var nuke = confirm('Warning: All stored surveys and photos will be lost.');
        if (!nuke)
            return;

        localStorage.clear();
        self.props.db.destroy().then(function() {
            window.location.reload();
        });
    },

    render: function() {
        var self = this;
        return (
            React.createElement("div", {className: "title_menu"}, 
                React.createElement("div", {className: "title_menu_option menu_restart", 
                    onClick: self.wipeActive
                }, 
                    "Cancel survey"
                ), 
                React.createElement("div", {className: "title_menu_option menu_clear", 
                    onClick: self.wipeAll
                }, 
                    "Clear all saved surveys"
                )
            )
       )
    }
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"../../api/PhotoAPI.js":3}],20:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);

/*
 * Message component
 *
 * @text: text to render
 */
module.exports = React.createClass({displayName: "exports",
    render: function() {
        var textClass = this.props.classes;
        return (
                React.createElement("div", {className: "content-padded"}, 
                        React.createElement("p", {className: textClass}, this.props.text)
                )
               )
    }
});



}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],21:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);

/*
 * ResponseField component
 * Main input field component, handles validation
 *
 * props:
 *  @onInput: What to do on valid input
 *  @index: What index value to send on valid input (i.e position in array of fields)
 *  @showMinus: Show the 'X' on the input
 *  @buttonFunction: What to do on 'X' click event, index value is bound to this function
 *  @initValue: Initial value for the input field
 */
module.exports = React.createClass({displayName: "exports",

    /*
     * Validate the answer based on props.type
     *
     * @answer: The response to be validated
     *
     * TODO: implement photo validation, if necessary...
     */
    validate: function(answer) {
        return true;
    },

    /*
     * Handle change event, validates on every change
     * fires props.onInput on validation success
     *
     * @event: Change event
     */
    // onChange: function(event) {

    // },

    render: function() {
        return (
                React.createElement("div", {className: "photo_container"}, 
                    React.createElement("img", {
                        className: "photo_input", 
                        src: this.props.initValue, 
                        disabled: this.props.disabled
                     }, 
                     this.props.showMinus ?
                        React.createElement("span", {
                            onClick: this.props.buttonFunction.bind(null, this.props.index), 
                            disabled: this.props.disabled, 
                            className: "icon icon-close question__minus"}
                        )
                        : null
                    )
                 )
               );
    }
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],22:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);

/*
 * ResponseField component
 * Main input field component, handles validation
 *
 * props:
 *  @type: question type constraint, sets the input type to it, defaults to text
 *  @logic: dictionary containing logic to enforce
 *  @onInput: What to do on valid input
 *  @index: What index value to send on valid input (i.e position in array of fields)
 *  @showMinus: Show the 'X' on the input
 *  @buttonFunction: What to do on 'X' click event, index value is bound to this function
 *  @placeholder: Placeholder text for input, defaults to 'Please provide a response'
 *  @initValue: Initial value for the input field
 */
module.exports = React.createClass({displayName: "exports",
    getInitialState: function() {
        return {
        };
    },

    // Determine the input field type based on props.type
    getResponseType: function() {
        var type = this.props.type;
        switch(type) {
            case 'integer':
            case 'decimal':
                return 'number';
            case 'timestamp':
                return 'datetime-local';
            case 'time':
                return 'time';
            case 'date':
                return 'date';
            case 'email':
                return 'email';
            default:
                return 'text';
        }
    },

    // Determine the input field step based on props.type
    getResponseStep: function() {
        var type = this.props.type;
        switch(type) {
            case 'decimal':
                return 'any';
            case 'timestamp':
                return '1';
            default:
                return null;
        }
    },

    /*
     * Validate the answer based on props.type
     *
     * @answer: The response to be validated
     */
    validate: function(answer) {
        var type = this.props.type;
        var logic = this.props.logic;
        console.log('Enforcing: ', logic);
        var val = null;
        switch(type) {
            case 'integer':
                val = parseInt(answer);
                if (isNaN(val)) {
                    val = null;
                    break;
                }

                if (logic && logic.min && typeof logic.min === 'number') {
                    if (val < logic.min) {
                        val = null;
                    }
                }

                if (logic && logic.max && typeof logic.max === 'number') {
                    if (val > logic.max) {
                        val = null;
                    }
                }

                break;
            case 'decimal':
                val = parseFloat(answer);
                if (isNaN(val)) {
                    val = null;
                }

                if (logic && logic.min && typeof logic.min === 'number') {
                    if (val < logic.min) {
                        val = null;
                    }
                }

                if (logic && logic.max && typeof logic.max === 'number') {
                    if (val > logic.max) {
                        val = null;
                    }
                }

                break;
            case 'date':
                var resp = new Date(answer);
                var day = ('0' + resp.getDate()).slice(-2);
                var month = ('0' + (resp.getMonth() + 1)).slice(-2);
                var year = resp.getFullYear();
                val = answer; //XXX Keep format?
                if(isNaN(year) || isNaN(month) || isNaN(day))  {
                    val = null;
                }

                if (logic && logic.min && !isNaN((new Date(logic.min)).getDate())) {
                    if (resp < new Date(logic.min)) {
                        val = null;
                    }
                }

                if (logic && logic.max && !isNaN((new Date(logic.max)).getDate())) {
                    if (resp > new Date(logic.max)) {
                        val = null;
                    }
                }

                break;
            case 'timestamp':
            case 'time':
                //TODO: enforce
            default:
              if (answer) {
                  val = answer;
              }
        }

        return val;

    },

    /*
     * Handle change event, validates on every change
     * fires props.onInput with validated value OR null
     *
     * @event: Change event
     */
    onChange: function(event) {
        var value = this.validate(event.target.value);
        var input = event.target;
        input.setCustomValidity('');

        if (value === null) {
            window.target = event.target;
            input.setCustomValidity('Invalid field.');
        }

        if (this.props.onInput)
            this.props.onInput(value, this.props.index);
    },

    render: function() {
        return (
                React.createElement("div", {className: "input_container"}, 
                    React.createElement("input", {
                        type: this.getResponseType(), 
                        step: this.getResponseStep(), 
                        placeholder: this.props.placeholder || 'Please provide a response.', 
                        onChange: this.onChange, 
                        defaultValue: this.props.initValue, 
                        disabled: this.props.disabled
                     }, 
                     this.props.showMinus ?
                        React.createElement("span", {
                            onClick: this.props.buttonFunction.bind(null, this.props.index), 
                            disabled: this.props.disabled, 
                            className: "icon icon-close question__minus"}
                        )
                        : null
                    )
                 )
               );
    }
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],23:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null),
    ResponseField = require('./ResponseField.js');

/*
 * Select component
 * Handles drop down and other input rendering
 *
 * props:
 *  @multiSelect: Boolean to activate multiselect mode
 *  @choices: Array of choices in Select, expects a dict with value and text
 *  @withOther: Allow for other responses, adds it to the choices and renders
 *      a ResponseField when selected
 *  @onInput: What to do on valid other input
 *  @onSelect: What to do on selection
 */
module.exports = React.createClass({displayName: "exports",
    getInitialState: function() {
        return {
            showOther: this.props.initSelect && this.props.initSelect.indexOf('other') > -1
        }
    },

    onChange: function(e) {
        var foundOther = false;
        var options = [];
        for (var i = 0; i < e.target.selectedOptions.length; i++) {
            option = e.target.selectedOptions[i];
            foundOther = foundOther | option.value === "other";
            options[i] = option.value;
        }

        if (this.props.onSelect)
            this.props.onSelect(options);

        this.setState({showOther: foundOther})
    },

    render: function() {
       var size = this.props.multiSelect ?
           this.props.choices.length + 1 + 1*this.props.withOther : 1;
        return (
                React.createElement("div", {className: "content-padded"}, 
                    React.createElement("select", {className: "noselect", onChange: this.onChange, 
                            multiple: this.props.multiSelect, 
                            size: size, 
                            defaultValue: this.props.multiSelect
                                ? this.props.initSelect
                                : this.props.initSelect
                                    ? this.props.initSelect[0]
                                    : null, 
                            
                            disabled: this.props.disabled
                    }, 

                    React.createElement("option", {key: "null", value: "null"}, "Please choose an option"), 
                    this.props.choices.map(function(choice) {
                        return (
                                React.createElement("option", {key: choice.value, value: choice.value}, 
                                     choice.text
                                )
                                )
                    }), 
                    this.props.withOther ?
                        React.createElement("option", {key: "other", value: "other"}, " Other ")
                        : null
                    ), 
                    this.state.showOther
                        ?   React.createElement(ResponseField, {
                                disabled: this.props.disabled, 
                                onInput: this.props.onInput, 
                                initValue: this.props.initValue}
                            )
                        :   null
                    
                )
               )

    }
});



}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./ResponseField.js":22}],24:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null);

/*
 * Title component
 *
 * props:
 *  @title: Title text to render in content
 *  @message: 'hint' text to render in content
 */
module.exports = React.createClass({displayName: "exports",
    render: function() {
        return ( 
                React.createElement("div", {className: "content-padded"}, 
                    React.createElement("h3", null, this.props.title), 
                    React.createElement("p", null, this.props.message)
                )
               )
    }
});


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],25:[function(require,module,exports){
module.exports = {
    revisit_url: null
};

},{}],26:[function(require,module,exports){
(function (global){
var React = (typeof window !== "undefined" ? window['React'] : typeof global !== "undefined" ? global['React'] : null),
    Application = require('./Application'),
    config = require('./conf/config');

/*
 * Entry point for template
 *
 * @survey: JSON representation of the survey
 * @revisit_url: Revisit url, set globally
 */
window.init = function(survey, url) {
    console.log('init');
    // Set revisit url
    config.revisit_url = url;

    // Listen to appcache updates, reload JS.
    window.applicationCache.addEventListener('updateready', function() {
        alert('Application updated, reloading ...');
        window.applicationCache.swapCache();
        window.location.reload();
    });

    React.render(
            React.createElement(Application, {survey: survey}),
            document.body
    );
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./Application":1,"./conf/config":25}],27:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],28:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],29:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            currentQueue[queueIndex].run();
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],30:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],31:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./support/isBuffer":30,"_process":29,"inherits":28}],32:[function(require,module,exports){
// Copyright (c) 2013 Pieroxy <pieroxy@pieroxy.net>
// This work is free. You can redistribute it and/or modify it
// under the terms of the WTFPL, Version 2
// For more information see LICENSE.txt or http://www.wtfpl.net/
//
// For more information, the home page:
// http://pieroxy.net/blog/pages/lz-string/testing.html
//
// LZ-based compression algorithm, version 1.4.4
var LZString = (function() {

// private property
var f = String.fromCharCode;
var keyStrBase64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
var keyStrUriSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
var baseReverseDic = {};

function getBaseValue(alphabet, character) {
  if (!baseReverseDic[alphabet]) {
    baseReverseDic[alphabet] = {};
    for (var i=0 ; i<alphabet.length ; i++) {
      baseReverseDic[alphabet][alphabet.charAt(i)] = i;
    }
  }
  return baseReverseDic[alphabet][character];
}

var LZString = {
  compressToBase64 : function (input) {
    if (input == null) return "";
    var res = LZString._compress(input, 6, function(a){return keyStrBase64.charAt(a);});
    switch (res.length % 4) { // To produce valid Base64
    default: // When could this happen ?
    case 0 : return res;
    case 1 : return res+"===";
    case 2 : return res+"==";
    case 3 : return res+"=";
    }
  },

  decompressFromBase64 : function (input) {
    if (input == null) return "";
    if (input == "") return null;
    return LZString._decompress(input.length, 32, function(index) { return getBaseValue(keyStrBase64, input.charAt(index)); });
  },

  compressToUTF16 : function (input) {
    if (input == null) return "";
    return LZString._compress(input, 15, function(a){return f(a+32);}) + " ";
  },

  decompressFromUTF16: function (compressed) {
    if (compressed == null) return "";
    if (compressed == "") return null;
    return LZString._decompress(compressed.length, 16384, function(index) { return compressed.charCodeAt(index) - 32; });
  },

  //compress into uint8array (UCS-2 big endian format)
  compressToUint8Array: function (uncompressed) {
    var compressed = LZString.compress(uncompressed);
    var buf=new Uint8Array(compressed.length*2); // 2 bytes per character

    for (var i=0, TotalLen=compressed.length; i<TotalLen; i++) {
      var current_value = compressed.charCodeAt(i);
      buf[i*2] = current_value >>> 8;
      buf[i*2+1] = current_value % 256;
    }
    return buf;
  },

  //decompress from uint8array (UCS-2 big endian format)
  decompressFromUint8Array:function (compressed) {
    if (compressed===null || compressed===undefined){
        return LZString.decompress(compressed);
    } else {
        var buf=new Array(compressed.length/2); // 2 bytes per character
        for (var i=0, TotalLen=buf.length; i<TotalLen; i++) {
          buf[i]=compressed[i*2]*256+compressed[i*2+1];
        }

        var result = [];
        buf.forEach(function (c) {
          result.push(f(c));
        });
        return LZString.decompress(result.join(''));

    }

  },


  //compress into a string that is already URI encoded
  compressToEncodedURIComponent: function (input) {
    if (input == null) return "";
    return LZString._compress(input, 6, function(a){return keyStrUriSafe.charAt(a);});
  },

  //decompress from an output of compressToEncodedURIComponent
  decompressFromEncodedURIComponent:function (input) {
    if (input == null) return "";
    if (input == "") return null;
    input = input.replace(/ /g, "+");
    return LZString._decompress(input.length, 32, function(index) { return getBaseValue(keyStrUriSafe, input.charAt(index)); });
  },

  compress: function (uncompressed) {
    return LZString._compress(uncompressed, 16, function(a){return f(a);});
  },
  _compress: function (uncompressed, bitsPerChar, getCharFromInt) {
    if (uncompressed == null) return "";
    var i, value,
        context_dictionary= {},
        context_dictionaryToCreate= {},
        context_c="",
        context_wc="",
        context_w="",
        context_enlargeIn= 2, // Compensate for the first entry which should not count
        context_dictSize= 3,
        context_numBits= 2,
        context_data=[],
        context_data_val=0,
        context_data_position=0,
        ii;

    for (ii = 0; ii < uncompressed.length; ii += 1) {
      context_c = uncompressed.charAt(ii);
      if (!Object.prototype.hasOwnProperty.call(context_dictionary,context_c)) {
        context_dictionary[context_c] = context_dictSize++;
        context_dictionaryToCreate[context_c] = true;
      }

      context_wc = context_w + context_c;
      if (Object.prototype.hasOwnProperty.call(context_dictionary,context_wc)) {
        context_w = context_wc;
      } else {
        if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate,context_w)) {
          if (context_w.charCodeAt(0)<256) {
            for (i=0 ; i<context_numBits ; i++) {
              context_data_val = (context_data_val << 1);
              if (context_data_position == bitsPerChar-1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
            }
            value = context_w.charCodeAt(0);
            for (i=0 ; i<8 ; i++) {
              context_data_val = (context_data_val << 1) | (value&1);
              if (context_data_position == bitsPerChar-1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = value >> 1;
            }
          } else {
            value = 1;
            for (i=0 ; i<context_numBits ; i++) {
              context_data_val = (context_data_val << 1) | value;
              if (context_data_position ==bitsPerChar-1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = 0;
            }
            value = context_w.charCodeAt(0);
            for (i=0 ; i<16 ; i++) {
              context_data_val = (context_data_val << 1) | (value&1);
              if (context_data_position == bitsPerChar-1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = value >> 1;
            }
          }
          context_enlargeIn--;
          if (context_enlargeIn == 0) {
            context_enlargeIn = Math.pow(2, context_numBits);
            context_numBits++;
          }
          delete context_dictionaryToCreate[context_w];
        } else {
          value = context_dictionary[context_w];
          for (i=0 ; i<context_numBits ; i++) {
            context_data_val = (context_data_val << 1) | (value&1);
            if (context_data_position == bitsPerChar-1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }


        }
        context_enlargeIn--;
        if (context_enlargeIn == 0) {
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        // Add wc to the dictionary.
        context_dictionary[context_wc] = context_dictSize++;
        context_w = String(context_c);
      }
    }

    // Output the code for w.
    if (context_w !== "") {
      if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate,context_w)) {
        if (context_w.charCodeAt(0)<256) {
          for (i=0 ; i<context_numBits ; i++) {
            context_data_val = (context_data_val << 1);
            if (context_data_position == bitsPerChar-1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
          }
          value = context_w.charCodeAt(0);
          for (i=0 ; i<8 ; i++) {
            context_data_val = (context_data_val << 1) | (value&1);
            if (context_data_position == bitsPerChar-1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        } else {
          value = 1;
          for (i=0 ; i<context_numBits ; i++) {
            context_data_val = (context_data_val << 1) | value;
            if (context_data_position == bitsPerChar-1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = 0;
          }
          value = context_w.charCodeAt(0);
          for (i=0 ; i<16 ; i++) {
            context_data_val = (context_data_val << 1) | (value&1);
            if (context_data_position == bitsPerChar-1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        }
        context_enlargeIn--;
        if (context_enlargeIn == 0) {
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        delete context_dictionaryToCreate[context_w];
      } else {
        value = context_dictionary[context_w];
        for (i=0 ; i<context_numBits ; i++) {
          context_data_val = (context_data_val << 1) | (value&1);
          if (context_data_position == bitsPerChar-1) {
            context_data_position = 0;
            context_data.push(getCharFromInt(context_data_val));
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value = value >> 1;
        }


      }
      context_enlargeIn--;
      if (context_enlargeIn == 0) {
        context_enlargeIn = Math.pow(2, context_numBits);
        context_numBits++;
      }
    }

    // Mark the end of the stream
    value = 2;
    for (i=0 ; i<context_numBits ; i++) {
      context_data_val = (context_data_val << 1) | (value&1);
      if (context_data_position == bitsPerChar-1) {
        context_data_position = 0;
        context_data.push(getCharFromInt(context_data_val));
        context_data_val = 0;
      } else {
        context_data_position++;
      }
      value = value >> 1;
    }

    // Flush the last char
    while (true) {
      context_data_val = (context_data_val << 1);
      if (context_data_position == bitsPerChar-1) {
        context_data.push(getCharFromInt(context_data_val));
        break;
      }
      else context_data_position++;
    }
    return context_data.join('');
  },

  decompress: function (compressed) {
    if (compressed == null) return "";
    if (compressed == "") return null;
    return LZString._decompress(compressed.length, 32768, function(index) { return compressed.charCodeAt(index); });
  },

  _decompress: function (length, resetValue, getNextValue) {
    var dictionary = [],
        next,
        enlargeIn = 4,
        dictSize = 4,
        numBits = 3,
        entry = "",
        result = [],
        i,
        w,
        bits, resb, maxpower, power,
        c,
        data = {val:getNextValue(0), position:resetValue, index:1};

    for (i = 0; i < 3; i += 1) {
      dictionary[i] = i;
    }

    bits = 0;
    maxpower = Math.pow(2,2);
    power=1;
    while (power!=maxpower) {
      resb = data.val & data.position;
      data.position >>= 1;
      if (data.position == 0) {
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      bits |= (resb>0 ? 1 : 0) * power;
      power <<= 1;
    }

    switch (next = bits) {
      case 0:
          bits = 0;
          maxpower = Math.pow(2,8);
          power=1;
          while (power!=maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb>0 ? 1 : 0) * power;
            power <<= 1;
          }
        c = f(bits);
        break;
      case 1:
          bits = 0;
          maxpower = Math.pow(2,16);
          power=1;
          while (power!=maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb>0 ? 1 : 0) * power;
            power <<= 1;
          }
        c = f(bits);
        break;
      case 2:
        return "";
    }
    dictionary[3] = c;
    w = c;
    result.push(c);
    while (true) {
      if (data.index > length) {
        return "";
      }

      bits = 0;
      maxpower = Math.pow(2,numBits);
      power=1;
      while (power!=maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position == 0) {
          data.position = resetValue;
          data.val = getNextValue(data.index++);
        }
        bits |= (resb>0 ? 1 : 0) * power;
        power <<= 1;
      }

      switch (c = bits) {
        case 0:
          bits = 0;
          maxpower = Math.pow(2,8);
          power=1;
          while (power!=maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb>0 ? 1 : 0) * power;
            power <<= 1;
          }

          dictionary[dictSize++] = f(bits);
          c = dictSize-1;
          enlargeIn--;
          break;
        case 1:
          bits = 0;
          maxpower = Math.pow(2,16);
          power=1;
          while (power!=maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb>0 ? 1 : 0) * power;
            power <<= 1;
          }
          dictionary[dictSize++] = f(bits);
          c = dictSize-1;
          enlargeIn--;
          break;
        case 2:
          return result.join('');
      }

      if (enlargeIn == 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }

      if (dictionary[c]) {
        entry = dictionary[c];
      } else {
        if (c === dictSize) {
          entry = w + w.charAt(0);
        } else {
          return null;
        }
      }
      result.push(entry);

      // Add w+entry[0] to the dictionary.
      dictionary[dictSize++] = w + entry.charAt(0);
      enlargeIn--;

      w = entry;

      if (enlargeIn == 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }

    }
  }
};
  return LZString;
})();

if (typeof define === 'function' && define.amd) {
  define(function () { return LZString; });
} else if( typeof module !== 'undefined' && module != null ) {
  module.exports = LZString
}

},{}],33:[function(require,module,exports){
(function (process){
'use strict';
var util = require('util');
var EventEmitter = require('events').EventEmitter;
function toArray(arr, start, end) {
  return Array.prototype.slice.call(arr, start, end)
}
function strongUnshift(x, arrLike) {
  var arr = toArray(arrLike);
  arr.unshift(x);
  return arr;
}


/**
 * MPromise constructor.
 *
 * _NOTE: The success and failure event names can be overridden by setting `Promise.SUCCESS` and `Promise.FAILURE` respectively._
 *
 * @param {Function} back a function that accepts `fn(err, ...){}` as signature
 * @inherits NodeJS EventEmitter http://nodejs.org/api/events.html#events_class_events_eventemitter
 * @event `reject`: Emits when the promise is rejected (event name may be overridden)
 * @event `fulfill`: Emits when the promise is fulfilled (event name may be overridden)
 * @api public
 */
function Promise(back) {
  this.emitter = new EventEmitter();
  this.emitted = {};
  this.ended = false;
  if ('function' == typeof back) {
    this.ended = true;
    this.onResolve(back);
  }
}


/*
 * Module exports.
 */
module.exports = Promise;


/*!
 * event names
 */
Promise.SUCCESS = 'fulfill';
Promise.FAILURE = 'reject';


/**
 * Adds `listener` to the `event`.
 *
 * If `event` is either the success or failure event and the event has already been emitted, the`listener` is called immediately and passed the results of the original emitted event.
 *
 * @param {String} event
 * @param {Function} callback
 * @return {MPromise} this
 * @api private
 */
Promise.prototype.on = function (event, callback) {
  if (this.emitted[event])
    callback.apply(undefined, this.emitted[event]);
  else
    this.emitter.on(event, callback);

  return this;
};


/**
 * Keeps track of emitted events to run them on `on`.
 *
 * @api private
 */
Promise.prototype.safeEmit = function (event) {
  // ensures a promise can't be fulfill() or reject() more than once
  if (event == Promise.SUCCESS || event == Promise.FAILURE) {
    if (this.emitted[Promise.SUCCESS] || this.emitted[Promise.FAILURE]) {
      return this;
    }
    this.emitted[event] = toArray(arguments, 1);
  }

  this.emitter.emit.apply(this.emitter, arguments);
  return this;
};


/**
 * @api private
 */
Promise.prototype.hasRejectListeners = function () {
  return EventEmitter.listenerCount(this.emitter, Promise.FAILURE) > 0;
};


/**
 * Fulfills this promise with passed arguments.
 *
 * If this promise has already been fulfilled or rejected, no action is taken.
 *
 * @api public
 */
Promise.prototype.fulfill = function () {
  return this.safeEmit.apply(this, strongUnshift(Promise.SUCCESS, arguments));
};


/**
 * Rejects this promise with `reason`.
 *
 * If this promise has already been fulfilled or rejected, no action is taken.
 *
 * @api public
 * @param {Object|String} reason
 * @return {MPromise} this
 */
Promise.prototype.reject = function (reason) {
  if (this.ended && !this.hasRejectListeners())
    throw reason;
  return this.safeEmit(Promise.FAILURE, reason);
};


/**
 * Resolves this promise to a rejected state if `err` is passed or
 * fulfilled state if no `err` is passed.
 *
 * @param {Error} [err] error or null
 * @param {Object} [val] value to fulfill the promise with
 * @api public
 */
Promise.prototype.resolve = function (err, val) {
  if (err) return this.reject(err);
  return this.fulfill(val);
};


/**
 * Adds a listener to the SUCCESS event.
 *
 * @return {MPromise} this
 * @api public
 */
Promise.prototype.onFulfill = function (fn) {
  if (!fn) return this;
  if ('function' != typeof fn) throw new TypeError("fn should be a function");
  return this.on(Promise.SUCCESS, fn);
};


/**
 * Adds a listener to the FAILURE event.
 *
 * @return {MPromise} this
 * @api public
 */
Promise.prototype.onReject = function (fn) {
  if (!fn) return this;
  if ('function' != typeof fn) throw new TypeError("fn should be a function");
  return this.on(Promise.FAILURE, fn);
};


/**
 * Adds a single function as a listener to both SUCCESS and FAILURE.
 *
 * It will be executed with traditional node.js argument position:
 * function (err, args...) {}
 *
 * Also marks the promise as `end`ed, since it's the common use-case, and yet has no
 * side effects unless `fn` is undefined or null.
 *
 * @param {Function} fn
 * @return {MPromise} this
 */
Promise.prototype.onResolve = function (fn) {
  if (!fn) return this;
  if ('function' != typeof fn) throw new TypeError("fn should be a function");
  this.on(Promise.FAILURE, function (err) { fn.call(this, err); });
  this.on(Promise.SUCCESS, function () { fn.apply(this, strongUnshift(null, arguments)); });
  return this;
};


/**
 * Creates a new promise and returns it. If `onFulfill` or
 * `onReject` are passed, they are added as SUCCESS/ERROR callbacks
 * to this promise after the next tick.
 *
 * Conforms to [promises/A+](https://github.com/promises-aplus/promises-spec) specification. Read for more detail how to use this method.
 *
 * ####Example:
 *
 *     var p = new Promise;
 *     p.then(function (arg) {
 *       return arg + 1;
 *     }).then(function (arg) {
 *       throw new Error(arg + ' is an error!');
 *     }).then(null, function (err) {
 *       assert.ok(err instanceof Error);
 *       assert.equal('2 is an error', err.message);
 *     });
 *     p.complete(1);
 *
 * @see promises-A+ https://github.com/promises-aplus/promises-spec
 * @param {Function} onFulfill
 * @param {Function} [onReject]
 * @return {MPromise} newPromise
 */
Promise.prototype.then = function (onFulfill, onReject) {
  var newPromise = new Promise;

  if ('function' == typeof onFulfill) {
    this.onFulfill(handler(newPromise, onFulfill));
  } else {
    this.onFulfill(newPromise.fulfill.bind(newPromise));
  }

  if ('function' == typeof onReject) {
    this.onReject(handler(newPromise, onReject));
  } else {
    this.onReject(newPromise.reject.bind(newPromise));
  }

  return newPromise;
};


function handler(promise, fn) {
  function newTickHandler() {
    var pDomain = promise.emitter.domain;
    if (pDomain && pDomain !== process.domain) pDomain.enter();
    try {
      var x = fn.apply(undefined, boundHandler.args);
    } catch (err) {
      promise.reject(err);
      return;
    }
    resolve(promise, x);
  }
  function boundHandler() {
    boundHandler.args = arguments;
    process.nextTick(newTickHandler);
  }
  return boundHandler;
}


function resolve(promise, x) {
  function fulfillOnce() {
    if (done++) return;
    resolve.apply(undefined, strongUnshift(promise, arguments));
  }
  function rejectOnce(reason) {
    if (done++) return;
    promise.reject(reason);
  }

  if (promise === x) {
    promise.reject(new TypeError("promise and x are the same"));
    return;
  }
  var rest = toArray(arguments, 1);
  var type = typeof x;
  if ('undefined' == type || null == x || !('object' == type || 'function' == type)) {
    promise.fulfill.apply(promise, rest);
    return;
  }

  try {
    var theThen = x.then;
  } catch (err) {
    promise.reject(err);
    return;
  }

  if ('function' != typeof theThen) {
    promise.fulfill.apply(promise, rest);
    return;
  }

  var done = 0;
  try {
    var ret = theThen.call(x, fulfillOnce, rejectOnce);
    return ret;
  } catch (err) {
    if (done++) return;
    promise.reject(err);
  }
}


/**
 * Signifies that this promise was the last in a chain of `then()s`: if a handler passed to the call to `then` which produced this promise throws, the exception will go uncaught.
 *
 * ####Example:
 *
 *     var p = new Promise;
 *     p.then(function(){ throw new Error('shucks') });
 *     setTimeout(function () {
 *       p.fulfill();
 *       // error was caught and swallowed by the promise returned from
 *       // p.then(). we either have to always register handlers on
 *       // the returned promises or we can do the following...
 *     }, 10);
 *
 *     // this time we use .end() which prevents catching thrown errors
 *     var p = new Promise;
 *     var p2 = p.then(function(){ throw new Error('shucks') }).end(); // <--
 *     setTimeout(function () {
 *       p.fulfill(); // throws "shucks"
 *     }, 10);
 *
 * @api public
 * @param {Function} [onReject]
 * @return {MPromise} this
 */
Promise.prototype.end = Promise.prototype['catch'] = function (onReject) {
  if (!onReject && !this.hasRejectListeners())
    onReject = function idRejector(e) { throw e; };
  this.onReject(onReject);
  this.ended = true;
  return this;
};


/**
 * A debug utility function that adds handlers to a promise that will log some output to the `console`
 *
 * ####Example:
 *
 *     var p = new Promise;
 *     p.then(function(){ throw new Error('shucks') });
 *     setTimeout(function () {
 *       p.fulfill();
 *       // error was caught and swallowed by the promise returned from
 *       // p.then(). we either have to always register handlers on
 *       // the returned promises or we can do the following...
 *     }, 10);
 *
 *     // this time we use .end() which prevents catching thrown errors
 *     var p = new Promise;
 *     var p2 = p.then(function(){ throw new Error('shucks') }).end(); // <--
 *     setTimeout(function () {
 *       p.fulfill(); // throws "shucks"
 *     }, 10);
 *
 * @api public
 * @param {MPromise} p
 * @param {String} name
 * @return {MPromise} this
 */
Promise.trace = function (p, name) {
  p.then(
    function () {
      console.log("%s fulfill %j", name, toArray(arguments));
    },
    function () {
      console.log("%s reject %j", name, toArray(arguments));
    }
  )
};


Promise.prototype.chain = function (p2) {
  var p1 = this;
  p1.onFulfill(p2.fulfill.bind(p2));
  p1.onReject(p2.reject.bind(p2));
  return p2;
};


Promise.prototype.all = function (promiseOfArr) {
  var pRet = new Promise;
  this.then(promiseOfArr).then(
    function (promiseArr) {
      var count = 0;
      var ret = [];
      var errSentinel;
      if (!promiseArr.length) pRet.resolve();
      promiseArr.forEach(function (promise, index) {
        if (errSentinel) return;
        count++;
        promise.then(
          function (val) {
            if (errSentinel) return;
            ret[index] = val;
            --count;
            if (count == 0) pRet.fulfill(ret);
          },
          function (err) {
            if (errSentinel) return;
            errSentinel = err;
            pRet.reject(err);
          }
        );
      });
      return pRet;
    }
    , pRet.reject.bind(pRet)
  );
  return pRet;
};


Promise.hook = function (arr) {
  var p1 = new Promise;
  var pFinal = new Promise;
  var signalP = function () {
    --count;
    if (count == 0)
      pFinal.fulfill();
    return pFinal;
  };
  var count = 1;
  var ps = p1;
  arr.forEach(function (hook) {
    ps = ps.then(
      function () {
        var p = new Promise;
        count++;
        hook(p.resolve.bind(p), signalP);
        return p;
      }
    )
  });
  ps = ps.then(signalP);
  p1.resolve();
  return ps;
};


/* This is for the A+ tests, but it's very useful as well */
Promise.fulfilled = function fulfilled() { var p = new Promise; p.fulfill.apply(p, arguments); return p; };
Promise.rejected = function rejected(reason) { return new Promise().reject(reason); };
Promise.deferred = function deferred() {
  var p = new Promise;
  return {
    promise: p,
    reject: p.reject.bind(p),
    resolve: p.fulfill.bind(p),
    callback: p.resolve.bind(p)
  }
};
/* End A+ tests adapter bit */

}).call(this,require('_process'))

},{"_process":29,"events":27,"util":31}],34:[function(require,module,exports){
//     uuid.js
//
//     Copyright (c) 2010-2012 Robert Kieffer
//     MIT License - http://opensource.org/licenses/mit-license.php

(function() {
  var _global = this;

  // Unique ID creation requires a high quality random # generator.  We feature
  // detect to determine the best RNG source, normalizing to a function that
  // returns 128-bits of randomness, since that's what's usually required
  var _rng;

  // Node.js crypto-based RNG - http://nodejs.org/docs/v0.6.2/api/crypto.html
  //
  // Moderately fast, high quality
  if (typeof(_global.require) == 'function') {
    try {
      var _rb = _global.require('crypto').randomBytes;
      _rng = _rb && function() {return _rb(16);};
    } catch(e) {}
  }

  if (!_rng && _global.crypto && crypto.getRandomValues) {
    // WHATWG crypto-based RNG - http://wiki.whatwg.org/wiki/Crypto
    //
    // Moderately fast, high quality
    var _rnds8 = new Uint8Array(16);
    _rng = function whatwgRNG() {
      crypto.getRandomValues(_rnds8);
      return _rnds8;
    };
  }

  if (!_rng) {
    // Math.random()-based (RNG)
    //
    // If all else fails, use Math.random().  It's fast, but is of unspecified
    // quality.
    var  _rnds = new Array(16);
    _rng = function() {
      for (var i = 0, r; i < 16; i++) {
        if ((i & 0x03) === 0) r = Math.random() * 0x100000000;
        _rnds[i] = r >>> ((i & 0x03) << 3) & 0xff;
      }

      return _rnds;
    };
  }

  // Buffer class to use
  var BufferClass = typeof(_global.Buffer) == 'function' ? _global.Buffer : Array;

  // Maps for number <-> hex string conversion
  var _byteToHex = [];
  var _hexToByte = {};
  for (var i = 0; i < 256; i++) {
    _byteToHex[i] = (i + 0x100).toString(16).substr(1);
    _hexToByte[_byteToHex[i]] = i;
  }

  // **`parse()` - Parse a UUID into it's component bytes**
  function parse(s, buf, offset) {
    var i = (buf && offset) || 0, ii = 0;

    buf = buf || [];
    s.toLowerCase().replace(/[0-9a-f]{2}/g, function(oct) {
      if (ii < 16) { // Don't overflow!
        buf[i + ii++] = _hexToByte[oct];
      }
    });

    // Zero out remaining bytes if string was short
    while (ii < 16) {
      buf[i + ii++] = 0;
    }

    return buf;
  }

  // **`unparse()` - Convert UUID byte array (ala parse()) into a string**
  function unparse(buf, offset) {
    var i = offset || 0, bth = _byteToHex;
    return  bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]];
  }

  // **`v1()` - Generate time-based UUID**
  //
  // Inspired by https://github.com/LiosK/UUID.js
  // and http://docs.python.org/library/uuid.html

  // random #'s we need to init node and clockseq
  var _seedBytes = _rng();

  // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
  var _nodeId = [
    _seedBytes[0] | 0x01,
    _seedBytes[1], _seedBytes[2], _seedBytes[3], _seedBytes[4], _seedBytes[5]
  ];

  // Per 4.2.2, randomize (14 bit) clockseq
  var _clockseq = (_seedBytes[6] << 8 | _seedBytes[7]) & 0x3fff;

  // Previous uuid creation time
  var _lastMSecs = 0, _lastNSecs = 0;

  // See https://github.com/broofa/node-uuid for API details
  function v1(options, buf, offset) {
    var i = buf && offset || 0;
    var b = buf || [];

    options = options || {};

    var clockseq = options.clockseq != null ? options.clockseq : _clockseq;

    // UUID timestamps are 100 nano-second units since the Gregorian epoch,
    // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
    // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
    // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.
    var msecs = options.msecs != null ? options.msecs : new Date().getTime();

    // Per 4.2.1.2, use count of uuid's generated during the current clock
    // cycle to simulate higher resolution clock
    var nsecs = options.nsecs != null ? options.nsecs : _lastNSecs + 1;

    // Time since last uuid creation (in msecs)
    var dt = (msecs - _lastMSecs) + (nsecs - _lastNSecs)/10000;

    // Per 4.2.1.2, Bump clockseq on clock regression
    if (dt < 0 && options.clockseq == null) {
      clockseq = clockseq + 1 & 0x3fff;
    }

    // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
    // time interval
    if ((dt < 0 || msecs > _lastMSecs) && options.nsecs == null) {
      nsecs = 0;
    }

    // Per 4.2.1.2 Throw error if too many uuids are requested
    if (nsecs >= 10000) {
      throw new Error('uuid.v1(): Can\'t create more than 10M uuids/sec');
    }

    _lastMSecs = msecs;
    _lastNSecs = nsecs;
    _clockseq = clockseq;

    // Per 4.1.4 - Convert from unix epoch to Gregorian epoch
    msecs += 12219292800000;

    // `time_low`
    var tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
    b[i++] = tl >>> 24 & 0xff;
    b[i++] = tl >>> 16 & 0xff;
    b[i++] = tl >>> 8 & 0xff;
    b[i++] = tl & 0xff;

    // `time_mid`
    var tmh = (msecs / 0x100000000 * 10000) & 0xfffffff;
    b[i++] = tmh >>> 8 & 0xff;
    b[i++] = tmh & 0xff;

    // `time_high_and_version`
    b[i++] = tmh >>> 24 & 0xf | 0x10; // include version
    b[i++] = tmh >>> 16 & 0xff;

    // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)
    b[i++] = clockseq >>> 8 | 0x80;

    // `clock_seq_low`
    b[i++] = clockseq & 0xff;

    // `node`
    var node = options.node || _nodeId;
    for (var n = 0; n < 6; n++) {
      b[i + n] = node[n];
    }

    return buf ? buf : unparse(b);
  }

  // **`v4()` - Generate random UUID**

  // See https://github.com/broofa/node-uuid for API details
  function v4(options, buf, offset) {
    // Deprecated - 'format' argument, as supported in v1.2
    var i = buf && offset || 0;

    if (typeof(options) == 'string') {
      buf = options == 'binary' ? new BufferClass(16) : null;
      options = null;
    }
    options = options || {};

    var rnds = options.random || (options.rng || _rng)();

    // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
    rnds[6] = (rnds[6] & 0x0f) | 0x40;
    rnds[8] = (rnds[8] & 0x3f) | 0x80;

    // Copy bytes to buffer, if provided
    if (buf) {
      for (var ii = 0; ii < 16; ii++) {
        buf[i + ii] = rnds[ii];
      }
    }

    return buf || unparse(rnds);
  }

  // Export public API
  var uuid = v4;
  uuid.v1 = v1;
  uuid.v4 = v4;
  uuid.parse = parse;
  uuid.unparse = unparse;
  uuid.BufferClass = BufferClass;

  if (typeof(module) != 'undefined' && module.exports) {
    // Publish as node.js module
    module.exports = uuid;
  } else  if (typeof define === 'function' && define.amd) {
    // Publish as AMD module
    define(function() {return uuid;});
 

  } else {
    // Publish as global (in browsers)
    var _previousRoot = _global.uuid;

    // **`noConflict()` - (browser only) to reset global 'uuid' var**
    uuid.noConflict = function() {
      _global.uuid = _previousRoot;
      return uuid;
    };

    _global.uuid = uuid;
  }
}).call(this);

},{}],35:[function(require,module,exports){
(function (global){
'use strict';

var PouchPromise;
/* istanbul ignore next */
if (typeof window !== 'undefined' && window.PouchDB) {
  PouchPromise = window.PouchDB.utils.Promise;
} else {
  PouchPromise = typeof global.Promise === 'function' ? global.Promise : require('lie');
}

// this is essentially the "update sugar" function from daleharvey/pouchdb#1388
// the diffFun tells us what delta to apply to the doc.  it either returns
// the doc, or false if it doesn't need to do an update after all
function upsertInner(db, docId, diffFun) {
  return new PouchPromise(function (fulfill, reject) {
    if (typeof docId !== 'string') {
      return reject(new Error('doc id is required'));
    }

    db.get(docId, function (err, doc) {
      if (err) {
        /* istanbul ignore next */
        if (err.status !== 404) {
          return reject(err);
        }
        doc = {};
      }

      // the user might change the _rev, so save it for posterity
      var docRev = doc._rev;
      var newDoc = diffFun(doc);

      if (!newDoc) {
        // if the diffFun returns falsy, we short-circuit as
        // an optimization
        return fulfill({updated: false, rev: docRev});
      }

      // users aren't allowed to modify these values,
      // so reset them here
      newDoc._id = docId;
      newDoc._rev = docRev;
      fulfill(tryAndPut(db, newDoc, diffFun));
    });
  });
}

function tryAndPut(db, doc, diffFun) {
  return db.put(doc).then(function (res) {
    return {
      updated: true,
      rev: res.rev
    };
  }, function (err) {
    /* istanbul ignore next */
    if (err.status !== 409) {
      throw err;
    }
    return upsertInner(db, doc._id, diffFun);
  });
}

exports.upsert = function upsert(docId, diffFun, cb) {
  var db = this;
  var promise = upsertInner(db, docId, diffFun);
  if (typeof cb !== 'function') {
    return promise;
  }
  promise.then(function (resp) {
    cb(null, resp);
  }, cb);
};

exports.putIfNotExists = function putIfNotExists(docId, doc, cb) {
  var db = this;

  if (typeof docId !== 'string') {
    cb = doc;
    doc = docId;
    docId = doc._id;
  }

  var diffFun = function (existingDoc) {
    if (existingDoc._rev) {
      return false; // do nothing
    }
    return doc;
  };

  var promise = upsertInner(db, docId, diffFun);
  if (typeof cb !== 'function') {
    return promise;
  }
  promise.then(function (resp) {
    cb(null, resp);
  }, cb);
};


/* istanbul ignore next */
if (typeof window !== 'undefined' && window.PouchDB) {
  window.PouchDB.plugin(exports);
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"lie":39}],36:[function(require,module,exports){
'use strict';

module.exports = INTERNAL;

function INTERNAL() {}
},{}],37:[function(require,module,exports){
'use strict';
var Promise = require('./promise');
var reject = require('./reject');
var resolve = require('./resolve');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = all;
function all(iterable) {
  if (Object.prototype.toString.call(iterable) !== '[object Array]') {
    return reject(new TypeError('must be an array'));
  }

  var len = iterable.length;
  var called = false;
  if (!len) {
    return resolve([]);
  }

  var values = new Array(len);
  var resolved = 0;
  var i = -1;
  var promise = new Promise(INTERNAL);
  
  while (++i < len) {
    allResolver(iterable[i], i);
  }
  return promise;
  function allResolver(value, i) {
    resolve(value).then(resolveFromAll, function (error) {
      if (!called) {
        called = true;
        handlers.reject(promise, error);
      }
    });
    function resolveFromAll(outValue) {
      values[i] = outValue;
      if (++resolved === len & !called) {
        called = true;
        handlers.resolve(promise, values);
      }
    }
  }
}
},{"./INTERNAL":36,"./handlers":38,"./promise":40,"./reject":43,"./resolve":44}],38:[function(require,module,exports){
'use strict';
var tryCatch = require('./tryCatch');
var resolveThenable = require('./resolveThenable');
var states = require('./states');

exports.resolve = function (self, value) {
  var result = tryCatch(getThen, value);
  if (result.status === 'error') {
    return exports.reject(self, result.value);
  }
  var thenable = result.value;

  if (thenable) {
    resolveThenable.safely(self, thenable);
  } else {
    self.state = states.FULFILLED;
    self.outcome = value;
    var i = -1;
    var len = self.queue.length;
    while (++i < len) {
      self.queue[i].callFulfilled(value);
    }
  }
  return self;
};
exports.reject = function (self, error) {
  self.state = states.REJECTED;
  self.outcome = error;
  var i = -1;
  var len = self.queue.length;
  while (++i < len) {
    self.queue[i].callRejected(error);
  }
  return self;
};

function getThen(obj) {
  // Make sure we only access the accessor once as required by the spec
  var then = obj && obj.then;
  if (obj && typeof obj === 'object' && typeof then === 'function') {
    return function appyThen() {
      then.apply(obj, arguments);
    };
  }
}

},{"./resolveThenable":45,"./states":46,"./tryCatch":47}],39:[function(require,module,exports){
module.exports = exports = require('./promise');

exports.resolve = require('./resolve');
exports.reject = require('./reject');
exports.all = require('./all');
exports.race = require('./race');

},{"./all":37,"./promise":40,"./race":42,"./reject":43,"./resolve":44}],40:[function(require,module,exports){
'use strict';

var unwrap = require('./unwrap');
var INTERNAL = require('./INTERNAL');
var resolveThenable = require('./resolveThenable');
var states = require('./states');
var QueueItem = require('./queueItem');

module.exports = Promise;
function Promise(resolver) {
  if (!(this instanceof Promise)) {
    return new Promise(resolver);
  }
  if (typeof resolver !== 'function') {
    throw new TypeError('resolver must be a function');
  }
  this.state = states.PENDING;
  this.queue = [];
  this.outcome = void 0;
  if (resolver !== INTERNAL) {
    resolveThenable.safely(this, resolver);
  }
}

Promise.prototype['catch'] = function (onRejected) {
  return this.then(null, onRejected);
};
Promise.prototype.then = function (onFulfilled, onRejected) {
  if (typeof onFulfilled !== 'function' && this.state === states.FULFILLED ||
    typeof onRejected !== 'function' && this.state === states.REJECTED) {
    return this;
  }
  var promise = new Promise(INTERNAL);
  if (this.state !== states.PENDING) {
    var resolver = this.state === states.FULFILLED ? onFulfilled : onRejected;
    unwrap(promise, resolver, this.outcome);
  } else {
    this.queue.push(new QueueItem(promise, onFulfilled, onRejected));
  }

  return promise;
};

},{"./INTERNAL":36,"./queueItem":41,"./resolveThenable":45,"./states":46,"./unwrap":48}],41:[function(require,module,exports){
'use strict';
var handlers = require('./handlers');
var unwrap = require('./unwrap');

module.exports = QueueItem;
function QueueItem(promise, onFulfilled, onRejected) {
  this.promise = promise;
  if (typeof onFulfilled === 'function') {
    this.onFulfilled = onFulfilled;
    this.callFulfilled = this.otherCallFulfilled;
  }
  if (typeof onRejected === 'function') {
    this.onRejected = onRejected;
    this.callRejected = this.otherCallRejected;
  }
}
QueueItem.prototype.callFulfilled = function (value) {
  handlers.resolve(this.promise, value);
};
QueueItem.prototype.otherCallFulfilled = function (value) {
  unwrap(this.promise, this.onFulfilled, value);
};
QueueItem.prototype.callRejected = function (value) {
  handlers.reject(this.promise, value);
};
QueueItem.prototype.otherCallRejected = function (value) {
  unwrap(this.promise, this.onRejected, value);
};

},{"./handlers":38,"./unwrap":48}],42:[function(require,module,exports){
'use strict';
var Promise = require('./promise');
var reject = require('./reject');
var resolve = require('./resolve');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = race;
function race(iterable) {
  if (Object.prototype.toString.call(iterable) !== '[object Array]') {
    return reject(new TypeError('must be an array'));
  }

  var len = iterable.length;
  var called = false;
  if (!len) {
    return resolve([]);
  }

  var i = -1;
  var promise = new Promise(INTERNAL);

  while (++i < len) {
    resolver(iterable[i]);
  }
  return promise;
  function resolver(value) {
    resolve(value).then(function (response) {
      if (!called) {
        called = true;
        handlers.resolve(promise, response);
      }
    }, function (error) {
      if (!called) {
        called = true;
        handlers.reject(promise, error);
      }
    });
  }
}

},{"./INTERNAL":36,"./handlers":38,"./promise":40,"./reject":43,"./resolve":44}],43:[function(require,module,exports){
'use strict';

var Promise = require('./promise');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = reject;

function reject(reason) {
	var promise = new Promise(INTERNAL);
	return handlers.reject(promise, reason);
}
},{"./INTERNAL":36,"./handlers":38,"./promise":40}],44:[function(require,module,exports){
'use strict';

var Promise = require('./promise');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = resolve;

var FALSE = handlers.resolve(new Promise(INTERNAL), false);
var NULL = handlers.resolve(new Promise(INTERNAL), null);
var UNDEFINED = handlers.resolve(new Promise(INTERNAL), void 0);
var ZERO = handlers.resolve(new Promise(INTERNAL), 0);
var EMPTYSTRING = handlers.resolve(new Promise(INTERNAL), '');

function resolve(value) {
  if (value) {
    if (value instanceof Promise) {
      return value;
    }
    return handlers.resolve(new Promise(INTERNAL), value);
  }
  var valueType = typeof value;
  switch (valueType) {
    case 'boolean':
      return FALSE;
    case 'undefined':
      return UNDEFINED;
    case 'object':
      return NULL;
    case 'number':
      return ZERO;
    case 'string':
      return EMPTYSTRING;
  }
}
},{"./INTERNAL":36,"./handlers":38,"./promise":40}],45:[function(require,module,exports){
'use strict';
var handlers = require('./handlers');
var tryCatch = require('./tryCatch');
function safelyResolveThenable(self, thenable) {
  // Either fulfill, reject or reject with error
  var called = false;
  function onError(value) {
    if (called) {
      return;
    }
    called = true;
    handlers.reject(self, value);
  }

  function onSuccess(value) {
    if (called) {
      return;
    }
    called = true;
    handlers.resolve(self, value);
  }

  function tryToUnwrap() {
    thenable(onSuccess, onError);
  }
  
  var result = tryCatch(tryToUnwrap);
  if (result.status === 'error') {
    onError(result.value);
  }
}
exports.safely = safelyResolveThenable;
},{"./handlers":38,"./tryCatch":47}],46:[function(require,module,exports){
// Lazy man's symbols for states

exports.REJECTED = ['REJECTED'];
exports.FULFILLED = ['FULFILLED'];
exports.PENDING = ['PENDING'];

},{}],47:[function(require,module,exports){
'use strict';

module.exports = tryCatch;

function tryCatch(func, value) {
  var out = {};
  try {
    out.value = func(value);
    out.status = 'success';
  } catch (e) {
    out.status = 'error';
    out.value = e;
  }
  return out;
}
},{}],48:[function(require,module,exports){
'use strict';

var immediate = require('immediate');
var handlers = require('./handlers');
module.exports = unwrap;

function unwrap(promise, func, value) {
  immediate(function () {
    var returnValue;
    try {
      returnValue = func(value);
    } catch (e) {
      return handlers.reject(promise, e);
    }
    if (returnValue === promise) {
      handlers.reject(promise, new TypeError('Cannot resolve promise with itself'));
    } else {
      handlers.resolve(promise, returnValue);
    }
  });
}
},{"./handlers":38,"immediate":49}],49:[function(require,module,exports){
(function (global){
'use strict';
var Mutation = global.MutationObserver || global.WebKitMutationObserver;

var scheduleDrain;

{
  if (Mutation) {
    var called = 0;
    var observer = new Mutation(nextTick);
    var element = global.document.createTextNode('');
    observer.observe(element, {
      characterData: true
    });
    scheduleDrain = function () {
      element.data = (called = ++called % 2);
    };
  } else if (!global.setImmediate && typeof global.MessageChannel !== 'undefined') {
    var channel = new global.MessageChannel();
    channel.port1.onmessage = nextTick;
    scheduleDrain = function () {
      channel.port2.postMessage(0);
    };
  } else if ('document' in global && 'onreadystatechange' in global.document.createElement('script')) {
    scheduleDrain = function () {

      // Create a <script> element; its readystatechange event will be fired asynchronously once it is inserted
      // into the document. Do so, thus queuing up the task. Remember to clean up once it's been called.
      var scriptEl = global.document.createElement('script');
      scriptEl.onreadystatechange = function () {
        nextTick();

        scriptEl.onreadystatechange = null;
        scriptEl.parentNode.removeChild(scriptEl);
        scriptEl = null;
      };
      global.document.documentElement.appendChild(scriptEl);
    };
  } else {
    scheduleDrain = function () {
      setTimeout(nextTick, 0);
    };
  }
}

var draining;
var queue = [];
//named nextTick for less confusing stack traces
function nextTick() {
  draining = true;
  var i, oldQueue;
  var len = queue.length;
  while (len) {
    oldQueue = queue;
    queue = [];
    i = -1;
    while (++i < len) {
      oldQueue[i]();
    }
    len = queue.length;
  }
  draining = false;
}

module.exports = immediate;
function immediate(task) {
  if (queue.push(task) === 1 && !draining) {
    scheduleDrain();
  }
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],50:[function(require,module,exports){
(function (global){
//    PouchDB 3.6.0
//    
//    (c) 2012-2015 Dale Harvey and the PouchDB team
//    PouchDB may be freely distributed under the Apache license, version 2.0.
//    For all details and documentation:
//    http://pouchdb.com
!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var t;t="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this,t.PouchDB=e()}}(function(){var define,module,exports;return function e(t,n,r){function o(s,a){if(!n[s]){if(!t[s]){var c="function"==typeof require&&require;if(!a&&c)return c(s,!0);if(i)return i(s,!0);var u=new Error("Cannot find module '"+s+"'");throw u.code="MODULE_NOT_FOUND",u}var f=n[s]={exports:{}};t[s][0].call(f.exports,function(e){var n=t[s][1][e];return o(n?n:e)},f,f.exports,e,t,n,r)}return n[s].exports}for(var i="function"==typeof require&&require,s=0;s<r.length;s++)o(r[s]);return o}({1:[function(e,t,n){(function(n){"use strict";function r(e,t){for(var n=0;n<e.length;n++)if(t(e[n],n)===!0)return e[n];return!1}function o(e){return function(t,n){t||n[0]&&n[0].error?e(t||n[0]):e(null,n.length?n[0]:n)}}function i(e){for(var t=0;t<e.length;t++){var n=e[t];if(n._deleted)delete n._attachments;else if(n._attachments)for(var r=Object.keys(n._attachments),o=0;o<r.length;o++){var i=r[o];n._attachments[i]=l.pick(n._attachments[i],["data","digest","content_type","revpos","stub"])}}}function s(e,t){var n=l.compare(e._id,t._id);if(0!==n)return n;var r=e._revisions?e._revisions.start:0,o=t._revisions?t._revisions.start:0;return l.compare(r,o)}function a(e){var t={},n=[];return d.traverseRevTree(e,function(e,r,o,i){var s=r+"-"+o;return e&&(t[s]=0),void 0!==i&&n.push({from:i,to:s}),s}),n.reverse(),n.forEach(function(e){void 0===t[e.from]?t[e.from]=1+t[e.to]:t[e.from]=Math.min(t[e.from],1+t[e.to])}),t}function c(e,t,n){var r="limit"in t?t.keys.slice(t.skip,t.limit+t.skip):t.skip>0?t.keys.slice(t.skip):t.keys;if(t.descending&&r.reverse(),!r.length)return e._allDocs({limit:0},n);var o={offset:t.skip};return _.all(r.map(function(n){var r=l.extend(!0,{key:n,deleted:"ok"},t);return["limit","skip","keys"].forEach(function(e){delete r[e]}),new _(function(t,i){e._allDocs(r,function(e,r){return e?i(e):(o.total_rows=r.total_rows,void t(r.rows[0]||{key:n,error:"not_found"}))})})})).then(function(e){return o.rows=e,o})}function u(e){var t=e._compactionQueue[0],r=t.opts,o=t.callback;e.get("_local/compaction")["catch"](function(){return!1}).then(function(t){t&&t.last_seq&&(r.last_seq=t.last_seq),e._compact(r,function(t,r){t?o(t):o(null,r),n.nextTick(function(){e._compactionQueue.shift(),e._compactionQueue.length&&u(e)})})})}function f(){h.call(this)}var l=e(48),d=e(37),p=e(24),h=e(52).EventEmitter,v=e(33),m=e(13),_=l.Promise;l.inherits(f,h),t.exports=f,f.prototype.post=l.adapterFun("post",function(e,t,n){return"function"==typeof t&&(n=t,t={}),"object"!=typeof e||Array.isArray(e)?n(p.error(p.NOT_AN_OBJECT)):void this.bulkDocs({docs:[e]},t,o(n))}),f.prototype.put=l.adapterFun("put",l.getArguments(function(e){var t,n,r,i,s=e.shift(),a="_id"in s;if("object"!=typeof s||Array.isArray(s))return(i=e.pop())(p.error(p.NOT_AN_OBJECT));for(s=l.clone(s);;)if(t=e.shift(),n=typeof t,"string"!==n||a?"string"!==n||!a||"_rev"in s?"object"===n?r=t:"function"===n&&(i=t):s._rev=t:(s._id=t,a=!0),!e.length)break;r=r||{};var c=l.invalidIdError(s._id);return c?i(c):l.isLocalId(s._id)&&"function"==typeof this._putLocal?s._deleted?this._removeLocal(s,i):this._putLocal(s,i):void this.bulkDocs({docs:[s]},r,o(i))})),f.prototype.putAttachment=l.adapterFun("putAttachment",function(e,t,n,r,o,i){function s(e){return e._attachments=e._attachments||{},e._attachments[t]={content_type:o,data:r},a.put(e)}var a=this;return"function"==typeof o&&(i=o,o=r,r=n,n=null),"undefined"==typeof o&&(o=r,r=n,n=null),a.get(e).then(function(e){if(e._rev!==n)throw p.error(p.REV_CONFLICT);return s(e)},function(t){if(t.reason===p.MISSING_DOC.message)return s({_id:e});throw t})}),f.prototype.removeAttachment=l.adapterFun("removeAttachment",function(e,t,n,r){var o=this;o.get(e,function(e,i){return e?void r(e):i._rev!==n?void r(p.error(p.REV_CONFLICT)):i._attachments?(delete i._attachments[t],0===Object.keys(i._attachments).length&&delete i._attachments,void o.put(i,r)):r()})}),f.prototype.remove=l.adapterFun("remove",function(e,t,n,r){var i;"string"==typeof t?(i={_id:e,_rev:t},"function"==typeof n&&(r=n,n={})):(i=e,"function"==typeof t?(r=t,n={}):(r=n,n=t)),n=l.clone(n||{}),n.was_delete=!0;var s={_id:i._id,_rev:i._rev||n.rev};return s._deleted=!0,l.isLocalId(s._id)&&"function"==typeof this._removeLocal?this._removeLocal(i,r):void this.bulkDocs({docs:[s]},n,o(r))}),f.prototype.revsDiff=l.adapterFun("revsDiff",function(e,t,n){function r(e,t){a.has(e)||a.set(e,{missing:[]}),a.get(e).missing.push(t)}function o(t,n){var o=e[t].slice(0);d.traverseRevTree(n,function(e,n,i,s,a){var c=n+"-"+i,u=o.indexOf(c);-1!==u&&(o.splice(u,1),"available"!==a.status&&r(t,c))}),o.forEach(function(e){r(t,e)})}"function"==typeof t&&(n=t,t={}),t=l.clone(t);var i=Object.keys(e);if(!i.length)return n(null,{});var s=0,a=new l.Map;i.map(function(t){this._getRevisionTree(t,function(r,c){if(r&&404===r.status&&"missing"===r.message)a.set(t,{missing:e[t]});else{if(r)return n(r);o(t,c)}if(++s===i.length){var u={};return a.forEach(function(e,t){u[t]=e}),n(null,u)}})},this)}),f.prototype.compactDocument=l.adapterFun("compactDocument",function(e,t,n){var r=this;this._getRevisionTree(e,function(o,i){if(o)return n(o);var s=a(i),c=[],u=[];Object.keys(s).forEach(function(e){s[e]>t&&c.push(e)}),d.traverseRevTree(i,function(e,t,n,r,o){var i=t+"-"+n;"available"===o.status&&-1!==c.indexOf(i)&&u.push(i)}),r._doCompaction(e,u,n)})}),f.prototype.compact=l.adapterFun("compact",function(e,t){"function"==typeof e&&(t=e,e={});var n=this;e=l.clone(e||{}),n._compactionQueue=n._compactionQueue||[],n._compactionQueue.push({opts:e,callback:t}),1===n._compactionQueue.length&&u(n)}),f.prototype._compact=function(e,t){function n(e){s.push(o.compactDocument(e.id,0))}function r(e){var n=e.last_seq;_.all(s).then(function(){return v(o,"_local/compaction",function(e){return!e.last_seq||e.last_seq<n?(e.last_seq=n,e):!1})}).then(function(){t(null,{ok:!0})})["catch"](t)}var o=this,i={returnDocs:!1,last_seq:e.last_seq||0},s=[];o.changes(i).on("change",n).on("complete",r).on("error",t)},f.prototype.get=l.adapterFun("get",function(e,t,n){function o(){var r=[],o=i.length;return o?void i.forEach(function(i){s.get(e,{rev:i,revs:t.revs,attachments:t.attachments},function(e,t){e?r.push({missing:i}):r.push({ok:t}),o--,o||n(null,r)})}):n(null,r)}if("function"==typeof t&&(n=t,t={}),"string"!=typeof e)return n(p.error(p.INVALID_ID));if(l.isLocalId(e)&&"function"==typeof this._getLocal)return this._getLocal(e,n);var i=[],s=this;if(!t.open_revs)return this._get(e,t,function(e,o){if(t=l.clone(t),e)return n(e);var i=o.doc,a=o.metadata,c=o.ctx;if(t.conflicts){var u=d.collectConflicts(a);u.length&&(i._conflicts=u)}if(l.isDeleted(a,i._rev)&&(i._deleted=!0),t.revs||t.revs_info){var f=d.rootToLeaf(a.rev_tree),p=r(f,function(e){return-1!==e.ids.map(function(e){return e.id}).indexOf(i._rev.split("-")[1])}),h=p.ids.map(function(e){return e.id}).indexOf(i._rev.split("-")[1])+1,v=p.ids.length-h;if(p.ids.splice(h,v),p.ids.reverse(),t.revs&&(i._revisions={start:p.pos+p.ids.length-1,ids:p.ids.map(function(e){return e.id})}),t.revs_info){var m=p.pos+p.ids.length;i._revs_info=p.ids.map(function(e){return m--,{rev:m+"-"+e.id,status:e.opts.status}})}}if(t.local_seq&&(l.info('The "local_seq" option is deprecated and will be removed'),i._local_seq=o.metadata.seq),t.attachments&&i._attachments){var _=i._attachments,g=Object.keys(_).length;if(0===g)return n(null,i);Object.keys(_).forEach(function(e){this._getAttachment(_[e],{encode:!0,ctx:c},function(t,r){var o=i._attachments[e];o.data=r,delete o.stub,delete o.length,--g||n(null,i)})},s)}else{if(i._attachments)for(var y in i._attachments)i._attachments.hasOwnProperty(y)&&(i._attachments[y].stub=!0);n(null,i)}});if("all"===t.open_revs)this._getRevisionTree(e,function(e,t){return e?n(e):(i=d.collectLeaves(t).map(function(e){return e.rev}),void o())});else{if(!Array.isArray(t.open_revs))return n(p.error(p.UNKNOWN_ERROR,"function_clause"));i=t.open_revs;for(var a=0;a<i.length;a++){var c=i[a];if("string"!=typeof c||!/^\d+-/.test(c))return n(p.error(p.INVALID_REV))}o()}}),f.prototype.getAttachment=l.adapterFun("getAttachment",function(e,t,n,r){var o=this;n instanceof Function&&(r=n,n={}),n=l.clone(n),this._get(e,n,function(e,i){return e?r(e):i.doc._attachments&&i.doc._attachments[t]?(n.ctx=i.ctx,void o._getAttachment(i.doc._attachments[t],n,r)):r(p.error(p.MISSING_DOC))})}),f.prototype.allDocs=l.adapterFun("allDocs",function(e,t){if("function"==typeof e&&(t=e,e={}),e=l.clone(e),e.skip="undefined"!=typeof e.skip?e.skip:0,"keys"in e){if(!Array.isArray(e.keys))return t(new TypeError("options.keys must be an array"));var n=["startkey","endkey","key"].filter(function(t){return t in e})[0];if(n)return void t(p.error(p.QUERY_PARSE_ERROR,"Query parameter `"+n+"` is not compatible with multi-get"));if("http"!==this.type())return c(this,e,t)}return this._allDocs(e,t)}),f.prototype.changes=function(e,t){return"function"==typeof e&&(t=e,e={}),new m(this,e,t)},f.prototype.close=l.adapterFun("close",function(e){return this._closed=!0,this._close(e)}),f.prototype.info=l.adapterFun("info",function(e){var t=this;this._info(function(n,r){return n?e(n):(r.db_name=r.db_name||t._db_name,r.auto_compaction=!(!t.auto_compaction||"http"===t.type()),void e(null,r))})}),f.prototype.id=l.adapterFun("id",function(e){return this._id(e)}),f.prototype.type=function(){return"function"==typeof this._type?this._type():this.adapter},f.prototype.bulkDocs=l.adapterFun("bulkDocs",function(e,t,n){if("function"==typeof t&&(n=t,t={}),t=l.clone(t),Array.isArray(e)&&(e={docs:e}),!e||!e.docs||!Array.isArray(e.docs))return n(p.error(p.MISSING_BULK_DOCS));for(var r=0;r<e.docs.length;++r)if("object"!=typeof e.docs[r]||Array.isArray(e.docs[r]))return n(p.error(p.NOT_AN_OBJECT));return e=l.clone(e),"new_edits"in t||("new_edits"in e?t.new_edits=e.new_edits:t.new_edits=!0),t.new_edits||"http"===this.type()||e.docs.sort(s),i(e.docs),this._bulkDocs(e,t,function(e,r){return e?n(e):(t.new_edits||(r=r.filter(function(e){return e.error})),void n(null,r))})}),f.prototype.registerDependentDatabase=l.adapterFun("registerDependentDatabase",function(e,t){function n(t){return t.dependentDbs=t.dependentDbs||{},t.dependentDbs[e]?!1:(t.dependentDbs[e]=!0,t)}var r=new this.constructor(e,this.__opts);v(this,"_local/_pouch_dependentDbs",n,function(e){return e?t(e):t(null,{db:r})})}),f.prototype.destroy=l.adapterFun("destroy",function(e){function t(){n._destroy(function(t,r){return t?e(t):(n.emit("destroyed"),void e(null,r||{ok:!0}))})}var n=this,r="use_prefix"in n?n.use_prefix:!0;n.get("_local/_pouch_dependentDbs",function(o,i){if(o)return 404!==o.status?e(o):t();var s=i.dependentDbs,a=n.constructor,c=Object.keys(s).map(function(e){var t=r?e.replace(new RegExp("^"+a.prefix),""):e;return new a(t,n.__opts).destroy()});_.all(c).then(t,function(t){e(t)})})})}).call(this,e(53))},{13:13,24:24,33:33,37:37,48:48,52:52,53:53}],2:[function(e,t,n){(function(n){"use strict";function r(e){return w?new v(function(t){d(e,function(e){t(g(e))})}):v.resolve(e.toString("base64"))}function o(e){return/^_design/.test(e)?"_design/"+encodeURIComponent(e.slice(8)):/^_local/.test(e)?"_local/"+encodeURIComponent(e.slice(7)):encodeURIComponent(e)}function i(e){return e._attachments&&Object.keys(e._attachments)?v.all(Object.keys(e._attachments).map(function(t){var n=e._attachments[t];return n.data&&"string"!=typeof n.data?r(n.data).then(function(e){n.data=e}):void 0})):v.resolve()}function s(e,t){if(/http(s?):/.test(e)){var n=h.parseUri(e);n.remote=!0,(n.user||n.password)&&(n.auth={username:n.user,password:n.password});var r=n.path.replace(/(^\/|\/$)/g,"").split("/");if(n.db=r.pop(),n.path=r.join("/"),t=t||{},t=m(t),n.headers=t.headers||t.ajax&&t.ajax.headers||{},t.auth||n.auth){var o=t.auth||n.auth,i=g(o.username+":"+o.password);n.headers.Authorization="Basic "+i}return t.headers&&(n.headers=t.headers),n}return{host:"",path:"/",db:e,auth:!1}}function a(e,t){return c(e,e.db+"/"+t)}function c(e,t){if(e.remote){var n=e.path?"/":"";return e.protocol+"://"+e.host+":"+e.port+"/"+e.path+n+t}return"/"+t}function u(e,t){function n(e,t){var n=h.extend(!0,m(O),e);return E(n.method+" "+n.url),h.ajax(n,t)}function u(e){return new v(function(t,r){n(e,function(e,n){return e?r(e):void t(n)})})}function d(e){return e.split("/").map(encodeURIComponent).join("/")}var _=this;_.getHost=e.getHost?e.getHost:s;var g=_.getHost(e.name,e),x=a(g,"");_.getUrl=function(){return x},_.getHeaders=function(){return m(g.headers)};var O=e.ajax||{};e=m(e);var A=function(){n({headers:m(g.headers),method:"PUT",url:x},function(e){e&&401===e.status?n({headers:m(g.headers),method:"HEAD",url:x},function(e){e?t(e):t(null,_)}):e&&412!==e.status?t(e):t(null,_)})};e.skipSetup||n({headers:m(g.headers),method:"GET",url:x},function(e){e?404===e.status?(h.explain404("PouchDB is just detecting if the remote DB exists."),A()):t(e):t(null,_)}),_.type=function(){return"http"},_.id=h.adapterFun("id",function(e){n({headers:m(g.headers),method:"GET",url:c(g,"")},function(t,n){if(t)return e(t);var r=n&&n.uuid?n.uuid+g.db:a(g,"");e(null,r)})}),_.request=h.adapterFun("request",function(e,t){e.headers=g.headers,e.url=a(g,e.url),n(e,t)}),_.compact=h.adapterFun("compact",function(e,t){"function"==typeof e&&(t=e,e={}),e=m(e),n({headers:m(g.headers),url:a(g,"_compact"),method:"POST"},function(){function n(){_.info(function(r,o){o.compact_running?setTimeout(n,e.interval||200):t(null,{ok:!0})})}"function"==typeof t&&n()})}),_._info=function(e){n({headers:m(g.headers),method:"GET",url:a(g,"")},function(t,n){t?e(t):(n.host=a(g,""),e(null,n))})},_.get=h.adapterFun("get",function(e,t,n){function i(e){var t=e._attachments,n=t&&Object.keys(t);return t&&n.length?v.all(n.map(function(n){var i=t[n],s=o(e._id)+"/"+d(n)+"?rev="+e._rev;return u({headers:m(g.headers),method:"GET",url:a(g,s),binary:!0}).then(r).then(function(e){delete i.stub,delete i.length,i.data=e})})):void 0}function s(e){return Array.isArray(e)?v.all(e.map(function(e){return e.ok?i(e.ok):void 0})):i(e)}"function"==typeof t&&(n=t,t={}),t=m(t);var c=[];t.revs&&c.push("revs=true"),t.revs_info&&c.push("revs_info=true"),t.local_seq&&c.push("local_seq=true"),t.open_revs&&("all"!==t.open_revs&&(t.open_revs=JSON.stringify(t.open_revs)),c.push("open_revs="+t.open_revs)),t.rev&&c.push("rev="+t.rev),t.conflicts&&c.push("conflicts="+t.conflicts),c=c.join("&"),c=""===c?"":"?"+c,e=o(e);var f={headers:m(g.headers),method:"GET",url:a(g,e+c)},l=t.ajax||{};h.extend(!0,f,l),u(f).then(function(e){return v.resolve().then(function(){return t.attachments?s(e):void 0}).then(function(){n(null,e)})})["catch"](n)}),_.remove=h.adapterFun("remove",function(e,t,r,i){var s;"string"==typeof t?(s={_id:e,_rev:t},"function"==typeof r&&(i=r,r={})):(s=e,"function"==typeof t?(i=t,r={}):(i=r,r=t));var c=s._rev||r.rev;n({headers:m(g.headers),method:"DELETE",url:a(g,o(s._id))+"?rev="+c},i)}),_.getAttachment=h.adapterFun("getAttachment",function(e,t,r,i){"function"==typeof r&&(i=r,r={});var s=r.rev?"?rev="+r.rev:"",c=a(g,o(e))+"/"+d(t)+s;n({headers:m(g.headers),method:"GET",url:c,binary:!0},i)}),_.removeAttachment=h.adapterFun("removeAttachment",function(e,t,r,i){var s=a(g,o(e)+"/"+d(t))+"?rev="+r;n({headers:m(g.headers),method:"DELETE",url:s},i)}),_.putAttachment=h.adapterFun("putAttachment",function(e,t,r,i,s,c){"function"==typeof s&&(c=s,s=i,i=r,r=null),"undefined"==typeof s&&(s=i,i=r,r=null);var u=o(e)+"/"+d(t),f=a(g,u);if(r&&(f+="?rev="+r),"string"==typeof i){var l;try{l=y(i)}catch(h){return c(b.error(b.BAD_ARG,"Attachments need to be base64 encoded"))}i=w?p(l,s):l?new S(l,"binary"):""}var v={headers:m(g.headers),method:"PUT",url:f,processData:!1,body:i,timeout:6e4};v.headers["Content-Type"]=s,n(v,c)}),_.put=h.adapterFun("put",h.getArguments(function(e){var t,n,r,s=e.shift(),c="_id"in s,f=e.pop();return"object"!=typeof s||Array.isArray(s)?f(b.error(b.NOT_AN_OBJECT)):(s=m(s),void i(s).then(function(){for(;;)if(t=e.shift(),n=typeof t,"string"!==n||c?"string"!==n||!c||"_rev"in s?"object"===n&&(r=m(t)):s._rev=t:(s._id=t,c=!0),!e.length)break;r=r||{};var i=h.invalidIdError(s._id);if(i)throw i;var l=[];r&&"undefined"!=typeof r.new_edits&&l.push("new_edits="+r.new_edits),l=l.join("&"),""!==l&&(l="?"+l);var d={headers:m(g.headers),method:"PUT",url:a(g,o(s._id))+l,body:s};return v.resolve().then(function(){var e=s._attachments&&Object.keys(s._attachments).filter(function(e){return!s._attachments[e].stub}).length;if(e){var t=T(s);d.body=t.body,d.processData=!1,d.headers=h.extend(d.headers,t.headers)}})["catch"](function(){throw new Error("Did you forget to base64-encode an attachment?")}).then(function(){return u(d)}).then(function(e){e.ok=!0,f(null,e)})})["catch"](f))})),_.post=h.adapterFun("post",function(e,t,n){return"function"==typeof t&&(n=t,t={}),t=m(t),"object"!=typeof e?n(b.error(b.NOT_AN_OBJECT)):("_id"in e||(e._id=h.uuid()),void _.put(e,t,function(e,t){return e?n(e):(t.ok=!0,void n(null,t))}))}),_._bulkDocs=function(e,t,r){"undefined"!=typeof t.new_edits&&(e.new_edits=t.new_edits),v.all(e.docs.map(i)).then(function(){n({headers:m(g.headers),method:"POST",url:a(g,"_bulk_docs"),body:e},function(e,t){return e?r(e):(t.forEach(function(e){e.ok=!0}),void r(null,t))})})["catch"](r)},_.allDocs=h.adapterFun("allDocs",function(e,t){"function"==typeof e&&(t=e,e={}),e=m(e);var r,o=[],i="GET";if(e.conflicts&&o.push("conflicts=true"),e.descending&&o.push("descending=true"),e.include_docs&&o.push("include_docs=true"),e.attachments&&o.push("attachments=true"),e.key&&o.push("key="+encodeURIComponent(JSON.stringify(e.key))),e.startkey&&o.push("startkey="+encodeURIComponent(JSON.stringify(e.startkey))),e.endkey&&o.push("endkey="+encodeURIComponent(JSON.stringify(e.endkey))),"undefined"!=typeof e.inclusive_end&&o.push("inclusive_end="+!!e.inclusive_end),"undefined"!=typeof e.limit&&o.push("limit="+e.limit),"undefined"!=typeof e.skip&&o.push("skip="+e.skip),o=o.join("&"),""!==o&&(o="?"+o),"undefined"!=typeof e.keys){var s="keys="+encodeURIComponent(JSON.stringify(e.keys));s.length+o.length+1<=l?o+=(-1!==o.indexOf("?")?"&":"?")+s:(i="POST",r=JSON.stringify({keys:e.keys}))}n({headers:m(g.headers),method:i,url:a(g,"_all_docs"+o),body:r},t)}),_._changes=function(e){var t="batch_size"in e?e.batch_size:f;e=m(e),e.timeout=e.timeout||3e4;var r={timeout:e.timeout-5e3},o="undefined"!=typeof e.limit?e.limit:!1;0===o&&(o=1);var i;i="returnDocs"in e?e.returnDocs:!0;var s=o;if(e.style&&(r.style=e.style),(e.include_docs||e.filter&&"function"==typeof e.filter)&&(r.include_docs=!0),e.attachments&&(r.attachments=!0),e.continuous&&(r.feed="longpoll"),e.conflicts&&(r.conflicts=!0),e.descending&&(r.descending=!0),e.filter&&"string"==typeof e.filter&&(r.filter=e.filter,"_view"===e.filter&&e.view&&"string"==typeof e.view&&(r.view=e.view)),e.query_params&&"object"==typeof e.query_params)for(var c in e.query_params)e.query_params.hasOwnProperty(c)&&(r[c]=e.query_params[c]);var u,d="GET";if(e.doc_ids){r.filter="_doc_ids";var p=JSON.stringify(e.doc_ids);p.length<l?r.doc_ids=p:(d="POST",u={doc_ids:e.doc_ids})}if(e.continuous&&_._useSSE)return _.sse(e,r,i);var v,y,E=function(i,c){if(!e.aborted){r.since=i,"object"==typeof r.since&&(r.since=JSON.stringify(r.since)),e.descending?o&&(r.limit=s):r.limit=!o||s>t?t:s;var f="?"+Object.keys(r).map(function(e){return e+"="+r[e]}).join("&"),l={headers:m(g.headers),method:d,url:a(g,"_changes"+f),timeout:e.timeout,body:u};y=i,e.aborted||(v=n(l,c))}},w=10,S=0,T={results:[]},x=function(n,r){if(!e.aborted){var a=0;if(r&&r.results){a=r.results.length,T.last_seq=r.last_seq;var c={};c.query=e.query_params,r.results=r.results.filter(function(t){s--;var n=h.filterChange(e)(t);return n&&(i&&T.results.push(t),h.call(e.onChange,t)),n})}else if(n)return e.aborted=!0,void h.call(e.complete,n);r&&r.last_seq&&(y=r.last_seq);var u=o&&0>=s||r&&t>a||e.descending;if((!e.continuous||o&&0>=s)&&u)h.call(e.complete,null,T);else{n?S+=1:S=0;var f=1<<S,l=w*f,d=e.maximumWait||3e4;if(l>d)return void h.call(e.complete,n||b.error(b.UNKNOWN_ERROR));setTimeout(function(){E(y,x)},l)}}};return E(e.since||0,x),{cancel:function(){e.aborted=!0,v&&v.abort()}}},_.sse=function(e,t,n){function r(t){var r=JSON.parse(t.data);n&&u.results.push(r),u.last_seq=r.seq,h.call(e.onChange,r)}function o(t){return c.removeEventListener("message",r,!1),l===!1?(_._useSSE=!1,void(f=_._changes(e))):(c.close(),void h.call(e.complete,t))}t.feed="eventsource",t.since=e.since||0,t.limit=e.limit,delete t.timeout;var i="?"+Object.keys(t).map(function(e){return e+"="+t[e]}).join("&"),s=a(g,"_changes"+i),c=new EventSource(s),u={results:[],last_seq:!1},f=!1,l=!1;return c.addEventListener("message",r,!1),c.onopen=function(){l=!0},c.onerror=o,{cancel:function(){return f?f.cancel():(c.removeEventListener("message",r,!1),void c.close())}}},_._useSSE=!1,_.revsDiff=h.adapterFun("revsDiff",function(e,t,r){"function"==typeof t&&(r=t,t={}),n({headers:m(g.headers),method:"POST",url:a(g,"_revs_diff"),body:JSON.stringify(e)},r)}),_._close=function(e){e()},_._destroy=function(t){n({url:a(g,""),method:"DELETE",headers:m(g.headers)},function(n,r){n?(_.emit("error",n),t(n)):(_.emit("destroyed"),_.constructor.emit("destroyed",e.name),t(null,r))})}}var f=25,l=1800,d=e(22),p=e(19),h=e(48),v=h.Promise,m=h.clone,_=e(17),g=_.btoa,y=_.atob,b=e(24),E=e(54)("pouchdb:http"),w="undefined"==typeof n||n.browser,S=e(23),T=e(27);u.valid=function(){return!0},t.exports=u}).call(this,e(53))},{17:17,19:19,22:22,23:23,24:24,27:27,48:48,53:53,54:54}],3:[function(e,t,n){"use strict";function r(e,t,n,r,o){try{if(e&&t)return o?IDBKeyRange.bound(t,e,!n,!1):IDBKeyRange.bound(e,t,!1,!n);if(e)return o?IDBKeyRange.upperBound(e):IDBKeyRange.lowerBound(e);if(t)return o?IDBKeyRange.lowerBound(t,!n):IDBKeyRange.upperBound(t,!n);if(r)return IDBKeyRange.only(r)}catch(i){return{error:i}}return null}function o(e,t,n,r){return"DataError"===n.name&&0===n.code?r(null,{total_rows:e._meta.docCount,offset:t.skip,rows:[]}):void r(a.error(a.IDB_ERROR,n.name,n.message))}function i(e,t,n,i){function a(e,i){function a(t,n,r){var o=t.id+"::"+r;L.get(o).onsuccess=function(r){n.doc=p(r.target.result),e.conflicts&&(n.doc._conflicts=s.collectConflicts(t)),v(n.doc,e,R)}}function c(t,n,r){var o={id:r.id,key:r.id,value:{rev:n}},i=r.deleted;if("ok"===e.deleted)N.push(o),i?(o.value.deleted=!0,o.doc=null):e.include_docs&&a(r,o,n);else if(!i&&S--<=0&&(N.push(o),e.include_docs&&a(r,o,n),0===--T))return;t["continue"]()}function u(e){j=t._meta.docCount;var n=e.target.result;if(n){var r=h(n.value),o=r.winningRev;c(n,o,r)}}function g(){i(null,{total_rows:j,offset:e.skip,rows:N})}function y(){e.attachments?m(N).then(g):g()}var b="startkey"in e?e.startkey:!1,E="endkey"in e?e.endkey:!1,w="key"in e?e.key:!1,S=e.skip||0,T="number"==typeof e.limit?e.limit:-1,x=e.inclusive_end!==!1,O="descending"in e&&e.descending?"prev":null,A=r(b,E,x,w,O);if(A&&A.error)return o(t,e,A.error,i);var k=[d,l];e.attachments&&k.push(f);var q=_(n,k,"readonly");if(q.error)return i(q.error);var R=q.txn,C=R.objectStore(d),D=R.objectStore(l),I=O?C.openCursor(A,O):C.openCursor(A),L=D.index("_doc_id_rev"),N=[],j=0;R.oncomplete=y,I.onsuccess=u}function c(e,n){return 0===e.limit?n(null,{total_rows:t._meta.docCount,offset:e.skip,rows:[]}):void a(e,n)}c(e,i)}var s=e(37),a=e(24),c=e(7),u=e(6),f=u.ATTACH_STORE,l=u.BY_SEQ_STORE,d=u.DOC_STORE,p=c.decodeDoc,h=c.decodeMetadata,v=c.fetchAttachmentsIfNecessary,m=c.postProcessAttachments,_=c.openTransactionSafely;t.exports=i},{24:24,37:37,6:6,7:7}],4:[function(e,t,n){"use strict";function r(e,t){return new o.Promise(function(n,r){var i=o.createBlob([""],{type:"image/png"});e.objectStore(s).put(i,"key"),e.oncomplete=function(){var e=t.transaction([s],"readwrite"),i=e.objectStore(s).get("key");i.onerror=r,i.onsuccess=function(e){var t=e.target.result,r=URL.createObjectURL(t);o.ajax({url:r,cache:!0,binary:!0},function(e,t){e&&405===e.status?n(!0):(n(!(!t||"image/png"!==t.type)),e&&404===e.status&&o.explain404("PouchDB is just detecting blob URL support.")),URL.revokeObjectURL(r)})}}})["catch"](function(){return!1})}var o=e(48),i=e(6),s=i.DETECT_BLOB_SUPPORT_STORE;t.exports=r},{48:48,6:6}],5:[function(e,t,n){"use strict";function r(e,t,n,r,s,a){function y(){var e=[l,f,u,p,d,c],t=g(r,e,"readwrite");return t.error?a(t.error):(C=t.txn,C.onerror=_(a),C.ontimeout=_(a),C.oncomplete=w,D=C.objectStore(l),I=C.objectStore(f),L=C.objectStore(u),N=C.objectStore(c),void T(function(e){return e?(G=!0,a(e)):void E()}))}function b(){o.processDocs(B,n,H,C,J,x,t)}function E(){function e(){++n===B.length&&b()}function t(t){var n=v(t.target.result);n&&H.set(n.id,n),e()}if(B.length)for(var n=0,r=0,i=B.length;i>r;r++){var s=B[r];if(s._id&&o.isLocalId(s._id))e();else{var a=D.get(s.metadata.id);a.onsuccess=t}}}function w(){G||(s.notify(n._meta.name),n._meta.docCount+=F,a(null,J))}function S(e,t){var n=L.get(e);n.onsuccess=function(n){if(n.target.result)t();else{var r=i.error(i.MISSING_STUB,"unknown stub attachment with digest "+e);r.status=412,t(r)}}}function T(e){function t(){++o===n.length&&e(r)}var n=[];if(B.forEach(function(e){e.data&&e.data._attachments&&Object.keys(e.data._attachments).forEach(function(t){var r=e.data._attachments[t];r.stub&&n.push(r.digest)})}),!n.length)return e();var r,o=0;n.forEach(function(e){S(e,function(e){e&&!r&&(r=e),t()})})}function x(e,t,n,r,o,i,s,a){F+=i;var c=e.data;c._id=e.metadata.id,c._rev=e.metadata.rev,r&&(c._deleted=!0);var u=c._attachments&&Object.keys(c._attachments).length;return u?k(e,t,n,o,s,a):void A(e,t,n,o,s,a)}function O(e){var t=o.compactTree(e.metadata);h(t,e.metadata.id,C)}function A(e,t,r,o,i,s){function a(i){o&&n.auto_compaction&&O(e),l.seq=i.target.result,delete l.rev;var s=m(l,t,r),a=D.put(s);a.onsuccess=u}function c(e){e.preventDefault(),e.stopPropagation();var t=I.index("_doc_id_rev"),n=t.getKey(f._doc_id_rev);n.onsuccess=function(e){var t=I.put(f,e.target.result);t.onsuccess=a}}function u(){J[i]={ok:!0,id:l.id,rev:t},H.set(e.metadata.id,e.metadata),q(e,l.seq,s)}var f=e.data,l=e.metadata;f._doc_id_rev=l.id+"::"+l.rev,delete f._id,delete f._rev;var d=I.put(f);d.onsuccess=a,d.onerror=c}function k(e,t,n,r,o,i){function s(){u===f.length&&A(e,t,n,r,o,i)}function a(){u++,s()}var c=e.data,u=0,f=Object.keys(c._attachments);f.forEach(function(t){var n=e.data._attachments[t];if(n.stub)u++,s();else{var r=n.data;delete n.data;var o=n.digest;R(o,r,a)}})}function q(e,t,n){function r(){++i===s.length&&n()}function o(n){var o=e.data._attachments[n].digest,i=N.put({seq:t,digestSeq:o+"::"+t});i.onsuccess=r,i.onerror=function(e){e.preventDefault(),e.stopPropagation(),r()}}var i=0,s=Object.keys(e.data._attachments||{});if(!s.length)return n();for(var a=0;a<s.length;a++)o(s[a])}function R(e,t,n){var r=L.count(e);r.onsuccess=function(r){var o=r.target.result;if(o)return n();var i={digest:e,body:t},s=L.put(i);s.onsuccess=n}}for(var C,D,I,L,N,j,B=e.docs,F=0,M=0,P=B.length;P>M;M++){var U=B[M];U._id&&o.isLocalId(U._id)||(U=B[M]=o.parseDoc(U,t.new_edits),U.error&&!j&&(j=U))}if(j)return a(j);var J=new Array(B.length),H=new o.Map,G=!1,V=n._meta.blobSupport?"blob":"base64";o.preprocessAttachments(B,V,function(e){return e?a(e):void y()})}var o=e(48),i=e(24),s=e(7),a=e(6),c=a.ATTACH_AND_SEQ_STORE,u=a.ATTACH_STORE,f=a.BY_SEQ_STORE,l=a.DOC_STORE,d=a.LOCAL_STORE,p=a.META_STORE,h=s.compactRevs,v=s.decodeMetadata,m=s.encodeMetadata,_=s.idbError,g=s.openTransactionSafely;t.exports=r},{24:24,48:48,6:6,7:7}],6:[function(e,t,n){"use strict";n.ADAPTER_VERSION=5,n.DOC_STORE="document-store",n.BY_SEQ_STORE="by-sequence",n.ATTACH_STORE="attach-store",n.ATTACH_AND_SEQ_STORE="attach-seq-store",n.META_STORE="meta-store",n.LOCAL_STORE="local-store",n.DETECT_BLOB_SUPPORT_STORE="detect-blob-support"},{}],7:[function(e,t,n){(function(t){"use strict";function r(e,t,n){try{e.apply(t,n)}catch(r){"undefined"!=typeof PouchDB&&PouchDB.emit("error",r)}}var o=e(24),i=e(48),s=e(17),a=s.atob,c=s.btoa,u=e(6),f=e(22),l=e(18);n.taskQueue={running:!1,queue:[]},n.applyNext=function(){if(!n.taskQueue.running&&n.taskQueue.queue.length){n.taskQueue.running=!0;var e=n.taskQueue.queue.shift();e.action(function(o,i){r(e.callback,this,[o,i]),n.taskQueue.running=!1,t.nextTick(n.applyNext)})}},n.idbError=function(e){return function(t){var n=t.target&&t.target.error&&t.target.error.name||t.target;e(o.error(o.IDB_ERROR,n,t.type))}},n.encodeMetadata=function(e,t,n){return{data:i.safeJsonStringify(e),winningRev:t,deletedOrLocal:n?"1":"0",seq:e.seq,id:e.id}},n.decodeMetadata=function(e){if(!e)return null;var t=i.safeJsonParse(e.data);return t.winningRev=e.winningRev,t.deleted="1"===e.deletedOrLocal,t.seq=e.seq,t},n.decodeDoc=function(e){if(!e)return e;var t=i.lastIndexOf(e._doc_id_rev,":");return e._id=e._doc_id_rev.substring(0,t-1),e._rev=e._doc_id_rev.substring(t+1),delete e._doc_id_rev,e},n.readBlobData=function(e,t,n,r){n?e?"string"!=typeof e?f(e,function(e){r(c(e))}):r(e):r(""):e?"string"!=typeof e?r(e):(e=l(a(e)),r(i.createBlob([e],{type:t}))):r(i.createBlob([""],{type:t}))},n.fetchAttachmentsIfNecessary=function(e,t,n,r){function o(){++a===s.length&&r&&r()}function i(e,t){var r=e._attachments[t],i=r.digest,s=n.objectStore(u.ATTACH_STORE).get(i);s.onsuccess=function(e){r.body=e.target.result.body,o()}}var s=Object.keys(e._attachments||{});if(!s.length)return r&&r();var a=0;s.forEach(function(n){t.attachments&&t.include_docs?i(e,n):(e._attachments[n].stub=!0,o())})},n.postProcessAttachments=function(e){return i.Promise.all(e.map(function(e){if(e.doc&&e.doc._attachments){var t=Object.keys(e.doc._attachments);return i.Promise.all(t.map(function(t){var r=e.doc._attachments[t];if("body"in r){var o=r.body,s=r.content_type;return new i.Promise(function(a){n.readBlobData(o,s,!0,function(n){e.doc._attachments[t]=i.extend(i.pick(r,["digest","content_type"]),{data:n}),a()})})}}))}}))},n.compactRevs=function(e,t,n){function r(){f--,f||o()}function o(){i.length&&i.forEach(function(e){var t=c.index("digestSeq").count(IDBKeyRange.bound(e+"::",e+"::￿",!1,!1));t.onsuccess=function(t){var n=t.target.result;n||a["delete"](e)}})}var i=[],s=n.objectStore(u.BY_SEQ_STORE),a=n.objectStore(u.ATTACH_STORE),c=n.objectStore(u.ATTACH_AND_SEQ_STORE),f=e.length;e.forEach(function(e){var n=s.index("_doc_id_rev"),o=t+"::"+e;n.getKey(o).onsuccess=function(e){var t=e.target.result;if("number"!=typeof t)return r();s["delete"](t);var n=c.index("seq").openCursor(IDBKeyRange.only(t));n.onsuccess=function(e){var t=e.target.result;if(t){var n=t.value.digestSeq.split("::")[0];i.push(n),c["delete"](t.primaryKey),t["continue"]()}else r()}}})},n.openTransactionSafely=function(e,t,n){try{return{txn:e.transaction(t,n)}}catch(r){return{error:r}}}}).call(this,e(53))},{17:17,18:18,22:22,24:24,48:48,53:53,6:6}],8:[function(e,t,n){(function(n){"use strict";function r(e,t){var n=this;C.queue.push({action:function(t){o(n,e,t)},callback:t}),w()}function o(e,t,o){function u(e){var t=e.createObjectStore(y,{keyPath:"id"});e.createObjectStore(_,{autoIncrement:!0}).createIndex("_doc_id_rev","_doc_id_rev",{unique:!0}),e.createObjectStore(m,{keyPath:"digest"}),e.createObjectStore(E,{keyPath:"id",autoIncrement:!1}),e.createObjectStore(g),t.createIndex("deletedOrLocal","deletedOrLocal",{unique:!1}),e.createObjectStore(b,{keyPath:"_id"});var n=e.createObjectStore(v,{autoIncrement:!0});n.createIndex("seq","seq"),n.createIndex("digestSeq","digestSeq",{unique:!0})}function f(e,t){var n=e.objectStore(y);n.createIndex("deletedOrLocal","deletedOrLocal",{unique:!1}),n.openCursor().onsuccess=function(e){var r=e.target.result;if(r){var o=r.value,i=s.isDeleted(o);o.deletedOrLocal=i?"1":"0",n.put(o),r["continue"]()}else t()}}function w(e){e.createObjectStore(b,{keyPath:"_id"}).createIndex("_doc_id_rev","_doc_id_rev",{unique:!0})}function C(e,t){var n=e.objectStore(b),r=e.objectStore(y),o=e.objectStore(_),i=r.openCursor();i.onsuccess=function(e){var i=e.target.result;if(i){var c=i.value,u=c.id,f=s.isLocalId(u),l=a.winningRev(c);
if(f){var d=u+"::"+l,p=u+"::",h=u+"::~",v=o.index("_doc_id_rev"),m=IDBKeyRange.bound(p,h,!1,!1),_=v.openCursor(m);_.onsuccess=function(e){if(_=e.target.result){var t=_.value;t._doc_id_rev===d&&n.put(t),o["delete"](_.primaryKey),_["continue"]()}else r["delete"](i.primaryKey),i["continue"]()}}else i["continue"]()}else t&&t()}}function L(e){var t=e.createObjectStore(v,{autoIncrement:!0});t.createIndex("seq","seq"),t.createIndex("digestSeq","digestSeq",{unique:!0})}function N(e,t){var n=e.objectStore(_),r=e.objectStore(m),o=e.objectStore(v),i=r.count();i.onsuccess=function(e){var r=e.target.result;return r?void(n.openCursor().onsuccess=function(e){var n=e.target.result;if(!n)return t();for(var r=n.value,i=n.primaryKey,s=Object.keys(r._attachments||{}),a={},c=0;c<s.length;c++){var u=r._attachments[s[c]];a[u.digest]=!0}var f=Object.keys(a);for(c=0;c<f.length;c++){var l=f[c];o.put({seq:i,digestSeq:l+"::"+i})}n["continue"]()}):t()}}function j(e){function t(e){return e.data?x(e):(e.deleted="1"===e.deletedOrLocal,e)}var n=e.objectStore(_),r=e.objectStore(y),o=r.openCursor();o.onsuccess=function(e){function o(){var e=c.id+"::",t=c.id+"::￿",r=n.index("_doc_id_rev").openCursor(IDBKeyRange.bound(e,t)),o=0;r.onsuccess=function(e){var t=e.target.result;if(!t)return c.seq=o,i();var n=t.primaryKey;n>o&&(o=n),t["continue"]()}}function i(){var e=O(c,c.winningRev,c.deleted),t=r.put(e);t.onsuccess=function(){s["continue"]()}}var s=e.target.result;if(s){var c=t(s.value);return c.winningRev=c.winningRev||a.winningRev(c),c.seq?i():void o()}}}var B=t.name,F=null;e._meta=null,e.type=function(){return"idb"},e._id=s.toPromise(function(t){t(null,e._meta.instanceId)}),e._bulkDocs=function(t,n,o){l(t,n,e,F,r.Changes,o)},e._get=function(e,t,n){function r(){n(a,{doc:o,metadata:i,ctx:u})}var o,i,a,u;if(t=s.clone(t),t.ctx)u=t.ctx;else{var f=D(F,[y,_,m],"readonly");if(f.error)return n(f.error);u=f.txn}u.objectStore(y).get(e).onsuccess=function(e){if(i=x(e.target.result),!i)return a=c.error(c.MISSING_DOC,"missing"),r();if(s.isDeleted(i)&&!t.rev)return a=c.error(c.MISSING_DOC,"deleted"),r();var n=u.objectStore(_),f=t.rev||i.winningRev,l=i.id+"::"+f;n.index("_doc_id_rev").get(l).onsuccess=function(e){return o=e.target.result,o&&(o=T(o)),o?void r():(a=c.error(c.MISSING_DOC,"missing"),r())}}},e._getAttachment=function(e,t,n){var r;if(t=s.clone(t),t.ctx)r=t.ctx;else{var o=D(F,[y,_,m],"readonly");if(o.error)return n(o.error);r=o.txn}var i=e.digest,a=e.content_type;r.objectStore(m).get(i).onsuccess=function(e){var r=e.target.result.body;R(r,a,t.encode,function(e){n(null,e)})}},e._info=function(t){if(null===F||!I[B]){var n=new Error("db isn't open");return n.id="idbNull",t(n)}var r,o,i=D(F,[_],"readonly");if(i.error)return t(i.error);var s=i.txn,a=s.objectStore(_).openCursor(null,"prev");a.onsuccess=function(t){var n=t.target.result;r=n?n.key:0,o=e._meta.docCount},s.oncomplete=function(){t(null,{doc_count:o,update_seq:r,idb_attachment_format:e._meta.blobSupport?"binary":"base64"})}},e._allDocs=function(t,n){d(t,e,F,n)},e._changes=function(t){function n(e){function n(){return a.seq!==s?e["continue"]():(l=s,a.winningRev===i._rev?o(i):void r())}function r(){var e=i._id+"::"+a.winningRev,t=v.index("_doc_id_rev").openCursor(IDBKeyRange.bound(e,e+"￿"));t.onsuccess=function(e){o(T(e.target.result.value))}}function o(n){var r=t.processChange(n,a,t);r.seq=a.seq,w(r)&&(E++,p&&b.push(r),t.attachments&&t.include_docs?A(n,t,h,function(){q([r]).then(function(){t.onChange(r)})}):t.onChange(r)),E!==d&&e["continue"]()}var i=T(e.value),s=e.key;if(u&&!u.has(i._id))return e["continue"]();var a;return(a=S.get(i._id))?n():void(g.get(i._id).onsuccess=function(e){a=x(e.target.result),S.set(i._id,a),n()})}function o(e){var t=e.target.result;t&&n(t)}function i(){var e=[y,_];t.attachments&&e.push(m);var n=D(F,e,"readonly");if(n.error)return t.complete(n.error);h=n.txn,h.onerror=k(t.complete),h.oncomplete=a,v=h.objectStore(_),g=h.objectStore(y);var r;r=f?v.openCursor(null,f):v.openCursor(IDBKeyRange.lowerBound(t.since,!0)),r.onsuccess=o}function a(){function e(){t.complete(null,{results:b,last_seq:l})}!t.continuous&&t.attachments?q(b).then(e):e()}if(t=s.clone(t),t.continuous){var c=B+":"+s.uuid();return r.Changes.addListener(B,c,e,t),r.Changes.notify(B),{cancel:function(){r.Changes.removeListener(B,c)}}}var u=t.doc_ids&&new s.Set(t.doc_ids),f=t.descending?"prev":null;t.since=t.since||0;var l=t.since,d="limit"in t?t.limit:-1;0===d&&(d=1);var p;p="returnDocs"in t?t.returnDocs:!0;var h,v,g,b=[],E=0,w=s.filterChange(t),S=new s.Map;i()},e._close=function(e){return null===F?e(c.error(c.NOT_OPEN)):(F.close(),delete I[B],F=null,void e())},e._getRevisionTree=function(e,t){var n=D(F,[y],"readonly");if(n.error)return t(n.error);var r=n.txn,o=r.objectStore(y).get(e);o.onsuccess=function(e){var n=x(e.target.result);n?t(null,n.rev_tree):t(c.error(c.MISSING_DOC))}},e._doCompaction=function(e,t,n){var r=[y,_,m,v],o=D(F,r,"readwrite");if(o.error)return n(o.error);var i=o.txn,c=i.objectStore(y);c.get(e).onsuccess=function(n){var r=x(n.target.result);a.traverseRevTree(r.rev_tree,function(e,n,r,o,i){var s=n+"-"+r;-1!==t.indexOf(s)&&(i.status="missing")}),S(t,e,i);var o=r.winningRev,s=r.deleted;i.objectStore(y).put(O(r,o,s))},i.onerror=k(n),i.oncomplete=function(){s.call(n)}},e._getLocal=function(e,t){var n=D(F,[b],"readonly");if(n.error)return t(n.error);var r=n.txn,o=r.objectStore(b).get(e);o.onerror=k(t),o.onsuccess=function(e){var n=e.target.result;n?(delete n._doc_id_rev,t(null,n)):t(c.error(c.MISSING_DOC))}},e._putLocal=function(e,t,n){"function"==typeof t&&(n=t,t={}),delete e._revisions;var r=e._rev,o=e._id;r?e._rev="0-"+(parseInt(r.split("-")[1],10)+1):e._rev="0-1";var i,s=t.ctx;if(!s){var a=D(F,[b],"readwrite");if(a.error)return n(a.error);s=a.txn,s.onerror=k(n),s.oncomplete=function(){i&&n(null,i)}}var u,f=s.objectStore(b);r?(u=f.get(o),u.onsuccess=function(o){var s=o.target.result;if(s&&s._rev===r){var a=f.put(e);a.onsuccess=function(){i={ok:!0,id:e._id,rev:e._rev},t.ctx&&n(null,i)}}else n(c.error(c.REV_CONFLICT))}):(u=f.add(e),u.onerror=function(e){n(c.error(c.REV_CONFLICT)),e.preventDefault(),e.stopPropagation()},u.onsuccess=function(){i={ok:!0,id:e._id,rev:e._rev},t.ctx&&n(null,i)})},e._removeLocal=function(e,t){var n=D(F,[b],"readwrite");if(n.error)return t(n.error);var r,o=n.txn;o.oncomplete=function(){r&&t(null,r)};var i=e._id,s=o.objectStore(b),a=s.get(i);a.onerror=k(t),a.onsuccess=function(n){var o=n.target.result;o&&o._rev===e._rev?(s["delete"](i),r={ok:!0,id:i,rev:"0-0"}):t(c.error(c.MISSING_DOC))}},e._destroy=function(e){r.Changes.removeAllListeners(B),r.openReqList[B]&&r.openReqList[B].result&&(r.openReqList[B].result.close(),delete I[B]);var t=indexedDB.deleteDatabase(B);t.onsuccess=function(){r.openReqList[B]&&(r.openReqList[B]=null),s.hasLocalStorage()&&B in localStorage&&delete localStorage[B],e(null,{ok:!0})},t.onerror=k(e)};var M=I[B];if(M)return F=M.idb,e._meta=M.global,void n.nextTick(function(){o(null,e)});var P=indexedDB.open(B,h);"openReqList"in r||(r.openReqList={}),r.openReqList[B]=P,P.onupgradeneeded=function(e){function t(){var e=o[i-1];i++,e&&e(r,t)}var n=e.target.result;if(e.oldVersion<1)return u(n);var r=e.currentTarget.transaction;e.oldVersion<3&&w(n),e.oldVersion<4&&L(n);var o=[f,C,N,j],i=e.oldVersion;t()},P.onsuccess=function(t){F=t.target.result,F.onversionchange=function(){F.close(),delete I[B]},F.onabort=function(){F.close(),delete I[B]};var n=F.transaction([E,g,y],"readwrite"),r=n.objectStore(E).get(E),a=null,c=null,u=null;r.onsuccess=function(t){var r=function(){null!==a&&null!==c&&null!==u&&(e._meta={name:B,instanceId:u,blobSupport:a,docCount:c},I[B]={idb:F,global:e._meta},o(null,e))},f=t.target.result||{id:E};B+"_id"in f?(u=f[B+"_id"],r()):(u=s.uuid(),f[B+"_id"]=u,n.objectStore(E).put(f).onsuccess=function(){r()}),i||(i=p(n,F)),i.then(function(e){a=e,r()});var l=n.objectStore(y).index("deletedOrLocal");l.count(IDBKeyRange.only("0")).onsuccess=function(e){c=e.target.result,r()}}},P.onerror=k(o)}var i,s=e(48),a=e(37),c=e(24),u=e(7),f=e(6),l=e(5),d=e(3),p=e(4),h=f.ADAPTER_VERSION,v=f.ATTACH_AND_SEQ_STORE,m=f.ATTACH_STORE,_=f.BY_SEQ_STORE,g=f.DETECT_BLOB_SUPPORT_STORE,y=f.DOC_STORE,b=f.LOCAL_STORE,E=f.META_STORE,w=u.applyNext,S=u.compactRevs,T=u.decodeDoc,x=u.decodeMetadata,O=u.encodeMetadata,A=u.fetchAttachmentsIfNecessary,k=u.idbError,q=u.postProcessAttachments,R=u.readBlobData,C=u.taskQueue,D=u.openTransactionSafely,I={};r.valid=function(){var e="undefined"!=typeof openDatabase&&/(Safari|iPhone|iPad|iPod)/.test(navigator.userAgent)&&!/Chrome/.test(navigator.userAgent)&&!/BlackBerry/.test(navigator.platform);return!e&&"undefined"!=typeof indexedDB&&"undefined"!=typeof IDBKeyRange},r.Changes=new s.Changes,t.exports=r}).call(this,e(53))},{24:24,3:3,37:37,4:4,48:48,5:5,53:53,6:6,7:7}],9:[function(e,t,n){"use strict";function r(e,t,n,r,a,m){function _(){return q?m(q):(a.notify(n._name),n._docCount=-1,void m(null,R))}function g(e,t){var n="SELECT count(*) as cnt FROM "+f+" WHERE digest=?";k.executeSql(n,[e],function(n,r){if(0===r.rows.item(0).cnt){var o=i.error(i.MISSING_STUB,"unknown stub attachment with digest "+e);t(o)}else t()})}function y(e){function t(){++o===n.length&&e(r)}var n=[];if(O.forEach(function(e){e.data&&e.data._attachments&&Object.keys(e.data._attachments).forEach(function(t){var r=e.data._attachments[t];r.stub&&n.push(r.digest)})}),!n.length)return e();var r,o=0;n.forEach(function(e){g(e,function(e){e&&!r&&(r=e),t()})})}function b(e,t,r,i,s,a,f,v){function m(){function t(e,t){function r(){return++i===s.length&&t(),!1}function o(t){var o="INSERT INTO "+l+" (digest, seq) VALUES (?,?)",i=[n._attachments[t].digest,e];k.executeSql(o,i,r,r)}var i=0,s=Object.keys(n._attachments||{});if(!s.length)return t();for(var a=0;a<s.length;a++)o(s[a])}var n=e.data,r=i?1:0,o=n._id,s=n._rev,a=p(n),c="INSERT INTO "+u+" (doc_id, rev, json, deleted) VALUES (?, ?, ?, ?);",f=[o,s,a,r];k.executeSql(c,f,function(e,n){var r=n.insertId;t(r,function(){b(e,r)})},function(){var e=d("seq",u,null,"doc_id=? AND rev=?");return k.executeSql(e,[o,s],function(e,n){var i=n.rows.item(0).seq,c="UPDATE "+u+" SET json=?, deleted=? WHERE doc_id=? AND rev=?;",f=[a,r,o,s];e.executeSql(c,f,function(e){t(i,function(){b(e,i)})})}),!1})}function _(e){E||(e?(E=e,v(E)):w===T.length&&m())}function g(e){w++,_(e)}function y(){if(s&&n.auto_compaction){var t=e.metadata.id,r=o.compactTree(e.metadata);h(r,t,k)}}function b(n,r){y(),e.metadata.seq=r,delete e.metadata.rev;var i=s?"UPDATE "+c+" SET json=?, max_seq=?, winningseq=(SELECT seq FROM "+u+" WHERE doc_id="+c+".id AND rev=?) WHERE id=?":"INSERT INTO "+c+" (id, winningseq, max_seq, json) VALUES (?,?,?,?);",a=o.safeJsonStringify(e.metadata),l=e.metadata.id,d=s?[a,r,t,l]:[l,r,r,a];n.executeSql(i,d,function(){R[f]={ok:!0,id:e.metadata.id,rev:t},C.set(l,e.metadata),v()})}var E=null,w=0;e.data._id=e.metadata.id,e.data._rev=e.metadata.rev;var T=Object.keys(e.data._attachments||{});i&&(e.data._deleted=!0),T.forEach(function(t){var n=e.data._attachments[t];if(n.stub)w++,_();else{var r=n.data;delete n.data;var o=n.digest;S(o,r,g)}}),T.length||m()}function E(){o.processDocs(O,n,C,k,R,b,t)}function w(e){function t(){++n===O.length&&e()}if(!O.length)return e();var n=0;O.forEach(function(e){if(e._id&&o.isLocalId(e._id))return t();var n=e.metadata.id;k.executeSql("SELECT json FROM "+c+" WHERE id = ?",[n],function(e,r){if(r.rows.length){var i=o.safeJsonParse(r.rows.item(0).json);C.set(n,i)}t()})})}function S(e,t,n){var r="SELECT digest FROM "+f+" WHERE digest=?";k.executeSql(r,[e],function(o,i){return i.rows.length?n():(r="INSERT INTO "+f+" (digest, body, escaped) VALUES (?,?,1)",void o.executeSql(r,[e,s.escapeBlob(t)],function(){n()},function(){return n(),!1}))})}var T=t.new_edits,x=e.docs,O=x.map(function(e){if(e._id&&o.isLocalId(e._id))return e;var t=o.parseDoc(e,T);return t}),A=O.filter(function(e){return e.error});if(A.length)return m(A[0]);var k,q,R=new Array(O.length),C=new o.Map;o.preprocessAttachments(O,"binary",function(e){return e?m(e):void r.transaction(function(e){k=e,y(function(e){e?q=e:w(E)})},v(m),_)})}var o=e(48),i=e(24),s=e(11),a=e(10),c=a.DOC_STORE,u=a.BY_SEQ_STORE,f=a.ATTACH_STORE,l=a.ATTACH_AND_SEQ_STORE,d=s.select,p=s.stringifyDoc,h=s.compactRevs,v=s.unknownError;t.exports=r},{10:10,11:11,24:24,48:48}],10:[function(e,t,n){"use strict";function r(e){return"'"+e+"'"}n.ADAPTER_VERSION=7,n.DOC_STORE=r("document-store"),n.BY_SEQ_STORE=r("by-sequence"),n.ATTACH_STORE=r("attach-store"),n.LOCAL_STORE=r("local-store"),n.META_STORE=r("metadata-store"),n.ATTACH_AND_SEQ_STORE=r("attach-seq-store")},{}],11:[function(e,t,n){"use strict";function r(e){return e.replace(/\u0002/g,"").replace(/\u0001/g,"").replace(/\u0000/g,"")}function o(e){return e.replace(/\u0001\u0001/g,"\x00").replace(/\u0001\u0002/g,"").replace(/\u0002\u0002/g,"")}function i(e){return delete e._id,delete e._rev,JSON.stringify(e)}function s(e,t,n){return e=JSON.parse(e),e._id=t,e._rev=n,e}function a(e){for(var t="(";e--;)t+="?",e&&(t+=",");return t+")"}function c(e,t,n,r,o){return"SELECT "+e+" FROM "+("string"==typeof t?t:t.join(" JOIN "))+(n?" ON "+n:"")+(r?" WHERE "+("string"==typeof r?r:r.join(" AND ")):"")+(o?" ORDER BY "+o:"")}function u(e,t,n){function r(){++i===e.length&&o()}function o(){if(s.length){var e="SELECT DISTINCT digest AS digest FROM "+b+" WHERE seq IN "+a(s.length);n.executeSql(e,s,function(e,t){for(var n=[],r=0;r<t.rows.length;r++)n.push(t.rows.item(r).digest);if(n.length){var o="DELETE FROM "+b+" WHERE seq IN ("+s.map(function(){return"?"}).join(",")+")";e.executeSql(o,s,function(e){var t="SELECT digest FROM "+b+" WHERE digest IN ("+n.map(function(){return"?"}).join(",")+")";e.executeSql(t,n,function(e,t){for(var r=new v.Set,o=0;o<t.rows.length;o++)r.add(t.rows.item(o).digest);n.forEach(function(t){r.has(t)||(e.executeSql("DELETE FROM "+b+" WHERE digest=?",[t]),e.executeSql("DELETE FROM "+y+" WHERE digest=?",[t]))})})})}})}}if(e.length){var i=0,s=[];e.forEach(function(e){var o="SELECT seq FROM "+g+" WHERE doc_id=? AND rev=?";n.executeSql(o,[t,e],function(e,t){if(!t.rows.length)return r();var n=t.rows.item(0).seq;s.push(n),e.executeSql("DELETE FROM "+g+" WHERE seq=?",[n],r)})})}}function f(e){return function(t){var n=t&&t.constructor.toString().match(/function ([^\(]+)/),r=n&&n[1]||t.type,o=t.target||t.message;e(m.error(m.WSQ_ERROR,o,r))}}function l(e){if("size"in e)return 1e6*e.size;var t=/Android/.test(window.navigator.userAgent);return t?5e6:1}function d(){return"undefined"!=typeof sqlitePlugin?sqlitePlugin.openDatabase.bind(sqlitePlugin):"undefined"!=typeof openDatabase?function(e){return openDatabase(e.name,e.version,e.description,e.size)}:void 0}function p(e){var t=d(),n=E[e.name];return n||(n=E[e.name]=t(e),n._sqlitePlugin="undefined"!=typeof sqlitePlugin),n}function h(){return"undefined"!=typeof openDatabase||"undefined"!=typeof SQLitePlugin}var v=e(48),m=e(24),_=e(10),g=_.BY_SEQ_STORE,y=_.ATTACH_STORE,b=_.ATTACH_AND_SEQ_STORE,E={};t.exports={escapeBlob:r,unescapeBlob:o,stringifyDoc:i,unstringifyDoc:s,qMarks:a,select:c,compactRevs:u,unknownError:f,getSize:l,openDB:p,valid:h}},{10:10,24:24,48:48}],12:[function(e,t,n){"use strict";function r(e,t,n,r,o){function s(){++u===c.length&&o&&o()}function a(e,t){var o=e._attachments[t],a={encode:!0,ctx:r};n._getAttachment(o,a,function(n,r){e._attachments[t]=i.extend(i.pick(o,["digest","content_type"]),{data:r}),s()})}var c=Object.keys(e._attachments||{});if(!c.length)return o&&o();var u=0;c.forEach(function(n){t.attachments&&t.include_docs?a(e,n):(e._attachments[n].stub=!0,s())})}function o(e,t){function n(){i.hasLocalStorage()&&(window.localStorage["_pouch__websqldb_"+K._name]=!0),t(null,K)}function f(e,t){e.executeSql(C),e.executeSql("ALTER TABLE "+v+" ADD COLUMN deleted TINYINT(1) DEFAULT 0",[],function(){e.executeSql(q),e.executeSql("ALTER TABLE "+h+" ADD COLUMN local TINYINT(1) DEFAULT 0",[],function(){e.executeSql("CREATE INDEX IF NOT EXISTS 'doc-store-local-idx' ON "+h+" (local, id)");var n="SELECT "+h+".winningseq AS seq, "+h+".json AS metadata FROM "+v+" JOIN "+h+" ON "+v+".seq = "+h+".winningseq";e.executeSql(n,[],function(e,n){for(var r=[],o=[],s=0;s<n.rows.length;s++){var a=n.rows.item(s),c=a.seq,u=JSON.parse(a.metadata);i.isDeleted(u)&&r.push(c),i.isLocalId(u.id)&&o.push(u.id)}e.executeSql("UPDATE "+h+"SET local = 1 WHERE id IN "+b(o.length),o,function(){e.executeSql("UPDATE "+v+" SET deleted = 1 WHERE seq IN "+b(r.length),r,t)})})})})}function j(e,t){var n="CREATE TABLE IF NOT EXISTS "+_+" (id UNIQUE, rev, json)";e.executeSql(n,[],function(){var n="SELECT "+h+".id AS id, "+v+".json AS data FROM "+v+" JOIN "+h+" ON "+v+".seq = "+h+".winningseq WHERE local = 1";e.executeSql(n,[],function(e,n){function r(){if(!o.length)return t(e);var n=o.shift(),i=JSON.parse(n.data)._rev;e.executeSql("INSERT INTO "+_+" (id, rev, json) VALUES (?,?,?)",[n.id,i,n.data],function(e){e.executeSql("DELETE FROM "+h+" WHERE id=?",[n.id],function(e){e.executeSql("DELETE FROM "+v+" WHERE seq=?",[n.seq],function(){r()})})})}for(var o=[],i=0;i<n.rows.length;i++)o.push(n.rows.item(i));r()})})}function B(e,t){function n(n){function r(){if(!n.length)return t(e);var o=n.shift(),i=c(o.hex,W),s=i.lastIndexOf("::"),a=i.substring(0,s),u=i.substring(s+2),f="UPDATE "+v+" SET doc_id=?, rev=? WHERE doc_id_rev=?";e.executeSql(f,[a,u,i],function(){r()})}r()}var r="ALTER TABLE "+v+" ADD COLUMN doc_id";e.executeSql(r,[],function(e){var t="ALTER TABLE "+v+" ADD COLUMN rev";e.executeSql(t,[],function(e){e.executeSql(R,[],function(e){var t="SELECT hex(doc_id_rev) as hex FROM "+v;e.executeSql(t,[],function(e,t){for(var r=[],o=0;o<t.rows.length;o++)r.push(t.rows.item(o));n(r)})})})})}function F(e,t){function n(e){var n="SELECT COUNT(*) AS cnt FROM "+m;e.executeSql(n,[],function(e,n){function r(){var n=S(N+", "+h+".id AS id",[h,v],L,null,h+".id ");n+=" LIMIT "+s+" OFFSET "+i,i+=s,e.executeSql(n,[],function(e,n){function o(e,t){var n=i[e]=i[e]||[];-1===n.indexOf(t)&&n.push(t)}if(!n.rows.length)return t(e);for(var i={},s=0;s<n.rows.length;s++)for(var a=n.rows.item(s),c=w(a.data,a.id,a.rev),u=Object.keys(c._attachments||{}),f=0;f<u.length;f++){var l=c._attachments[u[f]];o(l.digest,a.seq)}var d=[];if(Object.keys(i).forEach(function(e){var t=i[e];t.forEach(function(t){d.push([e,t])})}),!d.length)return r();var p=0;d.forEach(function(t){var n="INSERT INTO "+y+" (digest, seq) VALUES (?,?)";e.executeSql(n,t,function(){++p===d.length&&r()})})})}var o=n.rows.item(0).cnt;if(!o)return t(e);var i=0,s=10;r()})}var r="CREATE TABLE IF NOT EXISTS "+y+" (digest, seq INTEGER)";e.executeSql(r,[],function(e){e.executeSql(I,[],function(e){e.executeSql(D,[],n)})})}function M(e,t){var n="ALTER TABLE "+m+" ADD COLUMN escaped TINYINT(1) DEFAULT 0";e.executeSql(n,[],t)}function P(e,t){var n="ALTER TABLE "+h+" ADD COLUMN max_seq INTEGER";e.executeSql(n,[],function(e){var n="UPDATE "+h+" SET max_seq=(SELECT MAX(seq) FROM "+v+" WHERE doc_id=id)";e.executeSql(n,[],function(e){var n="CREATE UNIQUE INDEX IF NOT EXISTS 'doc-max-seq-idx' ON "+h+" (max_seq)";e.executeSql(n,[],t)})})}function U(e,t){e.executeSql('SELECT HEX("a") AS hex',[],function(e,n){var r=n.rows.item(0).hex;W=2===r.length?"UTF-8":"UTF-16",t()})}function J(){for(;Y.length>0;){var e=Y.pop();e(null,z)}}function H(e,t){if(0===t){var n="CREATE TABLE IF NOT EXISTS "+g+" (dbid, db_version INTEGER)",r="CREATE TABLE IF NOT EXISTS "+m+" (digest UNIQUE, escaped TINYINT(1), body BLOB)",o="CREATE TABLE IF NOT EXISTS "+y+" (digest, seq INTEGER)",s="CREATE TABLE IF NOT EXISTS "+h+" (id unique, json, winningseq, max_seq INTEGER UNIQUE)",a="CREATE TABLE IF NOT EXISTS "+v+" (seq INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, json, deleted TINYINT(1), doc_id, rev)",c="CREATE TABLE IF NOT EXISTS "+_+" (id UNIQUE, rev, json)";e.executeSql(r),e.executeSql(c),e.executeSql(o,[],function(){e.executeSql(D),e.executeSql(I)}),e.executeSql(s,[],function(){e.executeSql(C),e.executeSql(a,[],function(){e.executeSql(q),e.executeSql(R),e.executeSql(n,[],function(){var t="INSERT INTO "+g+" (db_version, dbid) VALUES (?,?)";z=i.uuid();var n=[p,z];e.executeSql(t,n,function(){J()})})})})}else{var u=function(){var n=p>t;n&&e.executeSql("UPDATE "+g+" SET db_version = "+p);var r="SELECT dbid FROM "+g;e.executeSql(r,[],function(e,t){z=t.rows.item(0).dbid,J()})},l=[f,j,B,F,M,P,u],d=t,b=function(e){l[d-1](e,b),d++};b(e)}}function G(){$.transaction(function(e){U(e,function(){V(e)})},x(t),n)}function V(e){var t="SELECT sql FROM sqlite_master WHERE tbl_name = "+g;e.executeSql(t,[],function(e,t){t.rows.length?/db_version/.test(t.rows.item(0).sql)?e.executeSql("SELECT db_version FROM "+g,[],function(e,t){var n=t.rows.item(0).db_version;H(e,n)}):e.executeSql("ALTER TABLE "+g+" ADD COLUMN db_version INTEGER",[],function(){H(e,1)}):H(e,0)})}function Q(e,t){if(-1!==K._docCount)return t(K._docCount);var n=S("COUNT("+h+".id) AS 'num'",[h,v],L,v+".deleted=0");e.executeSql(n,[],function(e,n){K._docCount=n.rows.item(0).num,t(K._docCount)})}var W,K=this,z=null,X=O(e),Y=[];K._docCount=-1,K._name=e.name;var $=A({name:K._name,version:k,description:K._name,size:X,location:e.location,createFromLocation:e.createFromLocation,androidDatabaseImplementation:e.androidDatabaseImplementation});return $?("function"!=typeof $.readTransaction&&($.readTransaction=$.transaction),i.isCordova()?window.addEventListener(K._name+"_pouch",function Z(){window.removeEventListener(K._name+"_pouch",Z,!1),G()},!1):G(),K.type=function(){return"websql"},K._id=i.toPromise(function(e){e(null,z)}),K._info=function(e){$.readTransaction(function(t){Q(t,function(n){var r="SELECT MAX(seq) AS seq FROM "+v;t.executeSql(r,[],function(t,r){var o=r.rows.item(0).seq||0;e(null,{doc_count:n,update_seq:o,sqlite_plugin:$._sqlitePlugin,websql_encoding:W})})})},x(e))},K._bulkDocs=function(e,t,n){d(e,t,K,$,o.Changes,n)},K._get=function(e,t,n){function r(){n(c,{doc:o,metadata:s,ctx:l})}t=i.clone(t);var o,s,c;if(!t.ctx)return void $.readTransaction(function(r){t.ctx=r,K._get(e,t,n)});var u,f,l=t.ctx;t.rev?(u=S(N,[h,v],h+".id="+v+".doc_id",[v+".doc_id=?",v+".rev=?"]),f=[e,t.rev]):(u=S(N,[h,v],L,h+".id=?"),f=[e]),l.executeSql(u,f,function(e,n){if(!n.rows.length)return c=a.error(a.MISSING_DOC,"missing"),r();var u=n.rows.item(0);return s=i.safeJsonParse(u.metadata),u.deleted&&!t.rev?(c=a.error(a.MISSING_DOC,"deleted"),r()):(o=w(u.data,s.id,u.rev),void r())})},K._allDocs=function(e,t){var n,o=[],a="startkey"in e?e.startkey:!1,c="endkey"in e?e.endkey:!1,u="key"in e?e.key:!1,f="descending"in e?e.descending:!1,l="limit"in e?e.limit:-1,d="skip"in e?e.skip:0,p=e.inclusive_end!==!1,m=[],_=[];if(u!==!1)_.push(h+".id = ?"),m.push(u);else if(a!==!1||c!==!1){if(a!==!1&&(_.push(h+".id "+(f?"<=":">=")+" ?"),m.push(a)),c!==!1){var g=f?">":"<";p&&(g+="="),_.push(h+".id "+g+" ?"),m.push(c)}u!==!1&&(_.push(h+".id = ?"),m.push(u))}"ok"!==e.deleted&&_.push(v+".deleted = 0"),$.readTransaction(function(t){Q(t,function(a){if(n=a,0!==l){var c=S(N,[h,v],L,_,h+".id "+(f?"DESC":"ASC"));c+=" LIMIT "+l+" OFFSET "+d,t.executeSql(c,m,function(t,n){for(var a=0,c=n.rows.length;c>a;a++){var u=n.rows.item(a),f=i.safeJsonParse(u.metadata),l=f.id,d=w(u.data,l,u.rev),p=d._rev,h={id:l,key:l,value:{rev:p}};if(e.include_docs&&(h.doc=d,h.doc._rev=p,e.conflicts&&(h.doc._conflicts=s.collectConflicts(f)),r(h.doc,e,K,t)),u.deleted){if("ok"!==e.deleted)continue;h.value.deleted=!0,h.doc=null}o.push(h)}})}})},x(t),function(){t(null,{total_rows:n,offset:e.skip,rows:o})})},K._changes=function(e){function t(){var t=h+".json AS metadata, "+h+".max_seq AS maxSeq, "+v+".json AS winningDoc, "+v+".rev AS winningRev ",n=h+" JOIN "+v,o=h+".id="+v+".doc_id AND "+h+".winningseq="+v+".seq",l=["maxSeq > ?"],d=[e.since];e.doc_ids&&(l.push(h+".id IN "+b(e.doc_ids.length)),d=d.concat(e.doc_ids));var p="maxSeq "+(s?"DESC":"ASC"),m=S(t,n,o,l,p),_=i.filterChange(e);e.view||e.filter||(m+=" LIMIT "+a);var g=e.since||0;$.readTransaction(function(t){t.executeSql(m,d,function(t,n){function o(t){return function(){e.onChange(t)}}for(var s=0,l=n.rows.length;l>s;s++){var d=n.rows.item(s),p=i.safeJsonParse(d.metadata);g=d.maxSeq;var h=w(d.winningDoc,p.id,d.winningRev),v=e.processChange(h,p,e);if(v.seq=d.maxSeq,_(v)&&(f++,c&&u.push(v),e.attachments&&e.include_docs?r(h,e,K,t,o(v)):o(v)()),f===a)break}})},x(e.complete),function(){e.continuous||e.complete(null,{results:u,last_seq:g})})}if(e=i.clone(e),e.continuous){var n=K._name+":"+i.uuid();return o.Changes.addListener(K._name,n,K,e),o.Changes.notify(K._name),{cancel:function(){o.Changes.removeListener(K._name,n)}}}var s=e.descending;e.since=e.since&&!s?e.since:0;var a="limit"in e?e.limit:-1;0===a&&(a=1);var c;c="returnDocs"in e?e.returnDocs:!0;var u=[],f=0;t()},K._close=function(e){e()},K._getAttachment=function(e,t,n){var r,o=t.ctx,s=e.digest,a=e.content_type,f="SELECT escaped, CASE WHEN escaped = 1 THEN body ELSE HEX(body) END AS body FROM "+m+" WHERE digest=?";o.executeSql(f,[s],function(e,o){var s=o.rows.item(0),f=s.escaped?l.unescapeBlob(s.body):c(s.body,W);r=t.encode?i.btoa(f):u(f,a),n(null,r)})},K._getRevisionTree=function(e,t){$.readTransaction(function(n){var r="SELECT json AS metadata FROM "+h+" WHERE id = ?";n.executeSql(r,[e],function(e,n){if(n.rows.length){var r=i.safeJsonParse(n.rows.item(0).metadata);t(null,r.rev_tree)}else t(a.error(a.MISSING_DOC))})})},K._doCompaction=function(e,t,n){return t.length?void $.transaction(function(n){var r="SELECT json AS metadata FROM "+h+" WHERE id = ?";n.executeSql(r,[e],function(n,r){var o=i.safeJsonParse(r.rows.item(0).metadata);s.traverseRevTree(o.rev_tree,function(e,n,r,o,i){var s=n+"-"+r;-1!==t.indexOf(s)&&(i.status="missing")});var a="UPDATE "+h+" SET json = ? WHERE id = ?";n.executeSql(a,[i.safeJsonStringify(o),e])}),T(t,e,n)},x(n),function(){n()}):n()},K._getLocal=function(e,t){$.readTransaction(function(n){var r="SELECT json, rev FROM "+_+" WHERE id=?";n.executeSql(r,[e],function(n,r){if(r.rows.length){var o=r.rows.item(0),i=w(o.json,e,o.rev);t(null,i)}else t(a.error(a.MISSING_DOC))})})},K._putLocal=function(e,t,n){function r(e){var r,f;i?(r="UPDATE "+_+" SET rev=?, json=? WHERE id=? AND rev=?",f=[o,u,s,i]):(r="INSERT INTO "+_+" (id, rev, json) VALUES (?,?,?)",f=[s,o,u]),e.executeSql(r,f,function(e,r){r.rowsAffected?(c={ok:!0,id:s,rev:o},t.ctx&&n(null,c)):n(a.error(a.REV_CONFLICT))},function(){return n(a.error(a.REV_CONFLICT)),!1})}"function"==typeof t&&(n=t,t={}),delete e._revisions;var o,i=e._rev,s=e._id;o=i?e._rev="0-"+(parseInt(i.split("-")[1],10)+1):e._rev="0-1";var c,u=E(e);t.ctx?r(t.ctx):$.transaction(function(e){r(e)},x(n),function(){c&&n(null,c)})},K._removeLocal=function(e,t){var n;$.transaction(function(r){var o="DELETE FROM "+_+" WHERE id=? AND rev=?",i=[e._id,e._rev];r.executeSql(o,i,function(r,o){return o.rowsAffected?void(n={ok:!0,id:e._id,rev:"0-0"}):t(a.error(a.MISSING_DOC))})},x(t),function(){n&&t(null,n)})},void(K._destroy=function(e){o.Changes.removeAllListeners(K._name),$.transaction(function(e){var t=[h,v,m,g,_,y];t.forEach(function(t){e.executeSql("DROP TABLE IF EXISTS "+t,[])})},x(e),function(){i.hasLocalStorage()&&(delete window.localStorage["_pouch__websqldb_"+K._name],delete window.localStorage[K._name]),e(null,{ok:!0})})})):t(a.error(a.UNKNOWN_ERROR))}var i=e(48),s=e(37),a=e(24),c=e(29),u=e(19),f=e(10),l=e(11),d=e(9),p=f.ADAPTER_VERSION,h=f.DOC_STORE,v=f.BY_SEQ_STORE,m=f.ATTACH_STORE,_=f.LOCAL_STORE,g=f.META_STORE,y=f.ATTACH_AND_SEQ_STORE,b=l.qMarks,E=l.stringifyDoc,w=l.unstringifyDoc,S=l.select,T=l.compactRevs,x=l.unknownError,O=l.getSize,A=l.openDB,k=1,q="CREATE INDEX IF NOT EXISTS 'by-seq-deleted-idx' ON "+v+" (seq, deleted)",R="CREATE UNIQUE INDEX IF NOT EXISTS 'by-seq-doc-id-rev' ON "+v+" (doc_id, rev)",C="CREATE INDEX IF NOT EXISTS 'doc-winningseq-idx' ON "+h+" (winningseq)",D="CREATE INDEX IF NOT EXISTS 'attach-seq-seq-idx' ON "+y+" (seq)",I="CREATE UNIQUE INDEX IF NOT EXISTS 'attach-seq-digest-idx' ON "+y+" (digest, seq)",L=v+".seq = "+h+".winningseq",N=v+".seq AS seq, "+v+".deleted AS deleted, "+v+".json AS data, "+v+".rev AS rev, "+h+".json AS metadata";o.valid=l.valid,o.Changes=new i.Changes,t.exports=o},{10:10,11:11,19:19,24:24,29:29,37:37,48:48,9:9}],13:[function(e,t,n){"use strict";function r(e,t,n){function r(){o.cancel()}c.call(this);var o=this;this.db=e,t=t?i.clone(t):{};var s=n||t.complete||function(){},a=t.complete=i.once(function(t,n){t?o.emit("error",t):o.emit("complete",n),o.removeAllListeners(),e.removeListener("destroyed",r)});s&&(o.on("complete",function(e){s(null,e)}),o.on("error",function(e){s(e)}));var u=t.onChange;u&&o.on("change",u),e.once("destroyed",r),t.onChange=function(e){t.isCancelled||(o.emit("change",e),o.startSeq&&o.startSeq<=e.seq&&(o.emit("uptodate"),o.startSeq=!1),e.deleted?o.emit("delete",e):1===e.changes.length&&"1-"===e.changes[0].rev.slice(0,2)?o.emit("create",e):o.emit("update",e))};var f=new i.Promise(function(e,n){t.complete=function(t,r){t?n(t):e(r)}});o.once("cancel",function(){u&&o.removeListener("change",u),e.removeListener("destroyed",r),t.complete(null,{status:"cancelled"})}),this.then=f.then.bind(f),this["catch"]=f["catch"].bind(f),this.then(function(e){a(null,e)},a),e.taskqueue.isReady?o.doChanges(t):e.taskqueue.addTask(function(){o.isCancelled?o.emit("cancel"):o.doChanges(t)})}function o(e,t,n){var r=[{rev:e._rev}];"all_docs"===n.style&&(r=s.collectLeaves(t.rev_tree).map(function(e){return{rev:e.rev}}));var o={id:t.id,changes:r,doc:e};return i.isDeleted(t,e._rev)&&(o.deleted=!0),n.conflicts&&(o.doc._conflicts=s.collectConflicts(t),o.doc._conflicts.length||delete o.doc._conflicts),o}var i=e(48),s=e(37),a=e(24),c=e(52).EventEmitter,u=e(35),f=e(36);t.exports=r,i.inherits(r,c),r.prototype.cancel=function(){this.isCancelled=!0,this.db.taskqueue.isReady&&this.emit("cancel")},r.prototype.doChanges=function(e){var t=this,n=e.complete;if(e=i.clone(e),"live"in e&&!("continuous"in e)&&(e.continuous=e.live),e.processChange=o,"latest"===e.since&&(e.since="now"),e.since||(e.since=0),"now"===e.since)return void this.db.info().then(function(r){return t.isCancelled?void n(null,{status:"cancelled"}):(e.since=r.update_seq,void t.doChanges(e))},n);if(e.continuous&&"now"!==e.since&&this.db.info().then(function(e){t.startSeq=e.update_seq},function(e){if("idbNull"!==e.id)throw e}),"http"!==this.db.type()&&e.filter&&"string"==typeof e.filter&&!e.doc_ids)return this.filterChanges(e);"descending"in e||(e.descending=!1),e.limit=0===e.limit?1:e.limit,e.complete=n;var r=this.db._changes(e);if(r&&"function"==typeof r.cancel){var s=t.cancel;t.cancel=i.getArguments(function(e){r.cancel(),s.apply(this,e)})}},r.prototype.filterChanges=function(e){var t=this,n=e.complete;if("_view"===e.filter){if(!e.view||"string"!=typeof e.view){var r=a.error(a.BAD_REQUEST,"`view` filter parameter is not provided.");return void n(r)}var o=e.view.split("/");this.db.get("_design/"+o[0],function(r,i){if(t.isCancelled)return void n(null,{status:"cancelled"});if(r)return void n(a.generateErrorFromResponse(r));if(i&&i.views&&i.views[o[1]]){var s=f(i.views[o[1]].map);return e.filter=s,void t.doChanges(e)}var c=i.views?"missing json key: "+o[1]:"missing json key: views";r||(r=a.error(a.MISSING_DOC,c)),n(r)})}else{var i=e.filter.split("/");this.db.get("_design/"+i[0],function(r,o){if(t.isCancelled)return void n(null,{status:"cancelled"});if(r)return void n(a.generateErrorFromResponse(r));if(o&&o.filters&&o.filters[i[1]]){var s=u(o.filters[i[1]]);return e.filter=s,void t.doChanges(e)}var c=o&&o.filters?"missing json key: "+i[1]:"missing json key: filters";return r||(r=a.error(a.MISSING_DOC,c)),void n(r)})}}},{24:24,35:35,36:36,37:37,48:48,52:52}],14:[function(e,t,n){(function(n,r){"use strict";function o(e){e&&r.debug&&console.error(e)}function i(e,t,r){if(!(this instanceof i))return new i(e,t,r);var f=this;("function"==typeof t||"undefined"==typeof t)&&(r=t,t={}),e&&"object"==typeof e&&(t=e,e=void 0),"undefined"==typeof r&&(r=o),e=e||t.name,t=t?a.clone(t):{},delete t.name,this.__opts=t;var l=r;f.auto_compaction=t.auto_compaction,f.prefix=i.prefix,s.call(f),
f.taskqueue=new c;var d=new u(function(o,s){r=function(e,t){return e?s(e):(delete t.then,void o(t))},t=a.clone(t);var c,u,l=t.name||e;return function(){try{if("string"!=typeof l)throw u=new Error("Missing/invalid DB name"),u.code=400,u;if(c=i.parseAdapter(l,t),t.originalName=l,t.name=c.name,t.prefix&&"http"!==c.adapter&&"https"!==c.adapter&&(t.name=t.prefix+t.name),t.adapter=t.adapter||c.adapter,f._adapter=t.adapter,f._db_name=l,!i.adapters[t.adapter])throw u=new Error("Adapter is missing"),u.code=404,u;if(!i.adapters[t.adapter].valid())throw u=new Error("Invalid Adapter"),u.code=404,u}catch(e){f.taskqueue.fail(e),f.changes=a.toPromise(function(t){t.complete&&t.complete(e)})}}(),u?s(u):(f.adapter=t.adapter,f.replicate={},f.replicate.from=function(e,t,n){return f.constructor.replicate(e,f,t,n)},f.replicate.to=function(e,t,n){return f.constructor.replicate(f,e,t,n)},f.sync=function(e,t,n){return f.constructor.sync(f,e,t,n)},f.replicate.sync=f.sync,i.adapters[t.adapter].call(f,t,function(e){function n(){i.emit("destroyed",t.originalName),i.emit(t.originalName,"destroyed"),f.removeListener("destroyed",n)}return e?void(r&&(f.taskqueue.fail(e),r(e))):(f.on("destroyed",n),f.emit("created",f),i.emit("created",t.originalName),f.taskqueue.ready(f),void r(null,f))}),t.skipSetup&&(f.taskqueue.ready(f),n.nextTick(function(){r(null,f)})),void(a.isCordova()&&cordova.fireWindowEvent(t.name+"_pouch",{})))});d.then(function(e){l(null,e)},l),f.then=d.then.bind(d),f["catch"]=d["catch"].bind(d)}var s=e(1),a=e(48),c=e(47),u=a.Promise;a.inherits(i,s),i.debug=e(54),t.exports=i}).call(this,e(53),"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{1:1,47:47,48:48,53:53,54:54}],15:[function(e,t,n){(function(n){"use strict";function r(e,t){function r(t,n,r){if(e.binary||e.json||!e.processData||"string"==typeof t){if(!e.binary&&e.json&&"string"==typeof t)try{t=JSON.parse(t)}catch(o){return r(o)}}else t=JSON.stringify(t);Array.isArray(t)&&(t=t.map(function(e){return e.error||e.missing?s.generateErrorFromResponse(e):e})),r(null,t,n)}function c(e,t){var n,r;if(e.code&&e.status){var o=new Error(e.message||e.code);return o.status=e.status,t(o)}try{n=JSON.parse(e.responseText),r=s.generateErrorFromResponse(n)}catch(i){r=s.generateErrorFromResponse(e)}t(r)}function u(e){return n.browser?"":new i("","binary")}var f=!1,l=a.getArguments(function(e){f||(t.apply(this,e),f=!0)});"function"==typeof e&&(l=e,e={}),e=a.clone(e);var d={method:"GET",headers:{},json:!0,processData:!0,timeout:1e4,cache:!1};return e=a.extend(!0,d,e),e.json&&(e.binary||(e.headers.Accept="application/json"),e.headers["Content-Type"]=e.headers["Content-Type"]||"application/json"),e.binary&&(e.encoding=null,e.json=!1),e.processData||(e.json=!1),o(e,function(t,n,o){if(t)return t.status=n?n.statusCode:400,c(t,l);var i,a=n.headers&&n.headers["content-type"],f=o||u();e.binary||!e.json&&e.processData||"object"==typeof f||!(/json/.test(a)||/^[\s]*\{/.test(f)&&/\}[\s]*$/.test(f))||(f=JSON.parse(f)),n.statusCode>=200&&n.statusCode<300?r(f,n,l):(e.binary&&(f=JSON.parse(f.toString())),i=s.generateErrorFromResponse(f),i.status=n.statusCode,l(i))})}var o=e(32),i=e(23),s=e(24),a=e(48);t.exports=r}).call(this,e(53))},{23:23,24:24,32:32,48:48,53:53}],16:[function(e,t,n){"use strict";t.exports=function(e){for(var t="",n=new Uint8Array(e),r=n.byteLength,o=0;r>o;o++)t+=String.fromCharCode(n[o]);return t}},{}],17:[function(e,t,n){"use strict";var r=e(23);"function"==typeof atob?n.atob=function(e){return atob(e)}:n.atob=function(e){var t=new r(e,"base64");if(t.toString("base64")!==e)throw"Cannot base64 encode full string";return t.toString("binary")},"function"==typeof btoa?n.btoa=function(e){return btoa(e)}:n.btoa=function(e){return new r(e,"binary").toString("base64")}},{23:23}],18:[function(e,t,n){"use strict";t.exports=function(e){for(var t=e.length,n=new ArrayBuffer(t),r=new Uint8Array(n),o=0;t>o;o++)r[o]=e.charCodeAt(o);return n}},{}],19:[function(e,t,n){"use strict";var r=e(20),o=e(18);t.exports=function(e,t){return r([o(e)],{type:t})}},{18:18,20:20}],20:[function(e,t,n){(function(e){"use strict";function n(t,n){t=t||[],n=n||{};try{return new Blob(t,n)}catch(r){if("TypeError"!==r.name)throw r;for(var o=e.BlobBuilder||e.MSBlobBuilder||e.MozBlobBuilder||e.WebKitBlobBuilder,i=new o,s=0;s<t.length;s+=1)i.append(t[s]);return i.getBlob(n.type)}}t.exports=n}).call(this,"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}],21:[function(e,t,n){"use strict";t.exports=function(e,t){var n=new FileReader;n.onloadend=function(e){var n=e.target.result||new ArrayBuffer(0);t(n)},n.readAsArrayBuffer(e)}},{}],22:[function(e,t,n){"use strict";var r=e(16);t.exports=function(e,t){var n=new FileReader,o="function"==typeof n.readAsBinaryString;n.onloadend=function(e){var n=e.target.result||"";return o?t(n):void t(r(n))},o?n.readAsBinaryString(e):n.readAsArrayBuffer(e)}},{16:16}],23:[function(e,t,n){t.exports={}},{}],24:[function(e,t,n){"use strict";function r(e){Error.call(e.reason),this.status=e.status,this.name=e.error,this.message=e.reason,this.error=!0}var o=e(57);o(r,Error),r.prototype.toString=function(){return JSON.stringify({status:this.status,name:this.name,message:this.message})},n.UNAUTHORIZED=new r({status:401,error:"unauthorized",reason:"Name or password is incorrect."}),n.MISSING_BULK_DOCS=new r({status:400,error:"bad_request",reason:"Missing JSON list of 'docs'"}),n.MISSING_DOC=new r({status:404,error:"not_found",reason:"missing"}),n.REV_CONFLICT=new r({status:409,error:"conflict",reason:"Document update conflict"}),n.INVALID_ID=new r({status:400,error:"invalid_id",reason:"_id field must contain a string"}),n.MISSING_ID=new r({status:412,error:"missing_id",reason:"_id is required for puts"}),n.RESERVED_ID=new r({status:400,error:"bad_request",reason:"Only reserved document ids may start with underscore."}),n.NOT_OPEN=new r({status:412,error:"precondition_failed",reason:"Database not open"}),n.UNKNOWN_ERROR=new r({status:500,error:"unknown_error",reason:"Database encountered an unknown error"}),n.BAD_ARG=new r({status:500,error:"badarg",reason:"Some query argument is invalid"}),n.INVALID_REQUEST=new r({status:400,error:"invalid_request",reason:"Request was invalid"}),n.QUERY_PARSE_ERROR=new r({status:400,error:"query_parse_error",reason:"Some query parameter is invalid"}),n.DOC_VALIDATION=new r({status:500,error:"doc_validation",reason:"Bad special document member"}),n.BAD_REQUEST=new r({status:400,error:"bad_request",reason:"Something wrong with the request"}),n.NOT_AN_OBJECT=new r({status:400,error:"bad_request",reason:"Document must be a JSON object"}),n.DB_MISSING=new r({status:404,error:"not_found",reason:"Database not found"}),n.IDB_ERROR=new r({status:500,error:"indexed_db_went_bad",reason:"unknown"}),n.WSQ_ERROR=new r({status:500,error:"web_sql_went_bad",reason:"unknown"}),n.LDB_ERROR=new r({status:500,error:"levelDB_went_went_bad",reason:"unknown"}),n.FORBIDDEN=new r({status:403,error:"forbidden",reason:"Forbidden by design doc validate_doc_update function"}),n.INVALID_REV=new r({status:400,error:"bad_request",reason:"Invalid rev format"}),n.FILE_EXISTS=new r({status:412,error:"file_exists",reason:"The database could not be created, the file already exists."}),n.MISSING_STUB=new r({status:412,error:"missing_stub"}),n.error=function(e,t,n){function o(t){for(var r in e)"function"!=typeof e[r]&&(this[r]=e[r]);void 0!==n&&(this.name=n),void 0!==t&&(this.reason=t)}return o.prototype=r.prototype,new o(t)},n.getErrorTypeByProp=function(e,t,r){var o=n,i=Object.keys(o).filter(function(n){var r=o[n];return"function"!=typeof r&&r[e]===t}),s=r&&i.filter(function(e){var t=o[e];return t.message===r})[0]||i[0];return s?o[s]:null},n.generateErrorFromResponse=function(e){var t,r,o,i,s,a=n;return r=e.error===!0&&"string"==typeof e.name?e.name:e.error,s=e.reason,o=a.getErrorTypeByProp("name",r,s),e.missing||"missing"===s||"deleted"===s||"not_found"===r?o=a.MISSING_DOC:"doc_validation"===r?(o=a.DOC_VALIDATION,i=s):"bad_request"===r&&o.message!==s&&(0===s.indexOf("unknown stub attachment")?(o=a.MISSING_STUB,i=s):o=a.BAD_REQUEST),o||(o=a.getErrorTypeByProp("status",e.status,s)||a.UNKNOWN_ERROR),t=a.error(o,s,r),i&&(t.message=i),e.id&&(t.id=e.id),e.status&&(t.status=e.status),e.statusText&&(t.name=e.statusText),e.missing&&(t.missing=e.missing),t}},{57:57}],25:[function(e,t,n){(function(e,n){"use strict";function r(t){e.browser&&"console"in n&&"info"in console&&console.info("The above 404 is totally normal. "+t)}t.exports=r}).call(this,e(53),"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{53:53}],26:[function(e,t,n){(function(n,r){"use strict";function o(e){return String.fromCharCode(255&e)+String.fromCharCode(e>>>8&255)+String.fromCharCode(e>>>16&255)+String.fromCharCode(e>>>24&255)}function i(e){for(var t="",n=0,r=e.length;r>n;n++)t+=o(e[n]);return c.btoa(t)}function s(e,t,n,r){(n>0||r<t.byteLength)&&(t=new Uint8Array(t,n,Math.min(r,t.byteLength)-n)),e.append(t)}function a(e,t,n,r){(n>0||r<t.length)&&(t=t.substring(n,r)),e.appendBinary(t)}var c=e(17),u=e(51),f=e(87),l=r.setImmediate||r.setTimeout,d=32768;t.exports=function(e,t){function r(){var n=m*h,o=n+h;if(m++,v>m)g(_,e,n,o),l(r);else{g(_,e,n,o);var s=_.end(!0),a=i(s);t(null,a),_.destroy()}}if(!n.browser){var o=u.createHash("md5").update(e).digest("base64");return void t(null,o)}var c="string"==typeof e,p=c?e.length:e.byteLength,h=Math.min(d,p),v=Math.ceil(p/h),m=0,_=c?new f:new f.ArrayBuffer,g=c?a:s;r()}}).call(this,e(53),"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{17:17,51:51,53:53,87:87}],27:[function(e,t,n){(function(n){"use strict";function r(e,t){return d?c(e,{type:t}):p.concat(e.map(function(e){return new p(e,"binary")}))}function o(e){e=l(e);var t=a(),n={};Object.keys(e._attachments).forEach(function(t){var r=e._attachments[t];if(!r.stub){var o=s(r.data);n[t]={type:r.content_type,data:o},r.length=o.length,r.follows=!0,delete r.digest,delete r.data}});var o="--"+t+"\r\nContent-Type: application/json\r\n\r\n",i=[o,JSON.stringify(e)];Object.keys(n).forEach(function(e){var r=n[e],o="\r\n--"+t+"\r\nContent-Disposition: attachment; filename="+JSON.stringify(e)+"\r\nContent-Type: "+r.type+"\r\nContent-Length: "+r.data.length+"\r\n\r\n";i.push(o),i.push(d?u(r.data):r.data)}),i.push("\r\n--"+t+"--");var c="multipart/related; boundary="+t,f=r(i,c);return{headers:{"Content-Type":c},body:f}}var i=e(17),s=i.atob,a=e(34),c=e(20),u=e(18),f=e(48),l=f.clone,d="undefined"==typeof n||n.browser,p=e(23);t.exports=o}).call(this,e(53))},{17:17,18:18,20:20,23:23,34:34,48:48,53:53}],28:[function(e,t,n){"use strict";function r(e){return e.reduce(function(e,t){return e[t]=!0,e},{})}function o(e){if(!/^\d+\-./.test(e))return s.error(s.INVALID_REV);var t=e.indexOf("-"),n=e.substring(0,t),r=e.substring(t+1);return{prefix:parseInt(n,10),id:r}}function i(e,t){for(var n=e.start-e.ids.length+1,r=e.ids,o=[r[0],t,[]],i=1,s=r.length;s>i;i++)o=[r[i],{status:"missing"},[o]];return[{pos:n,ids:o}]}var s=e(24),a=e(34),c=r(["_id","_rev","_attachments","_deleted","_revisions","_revs_info","_conflicts","_deleted_conflicts","_local_seq","_rev_tree","_replication_id","_replication_state","_replication_state_time","_replication_state_reason","_replication_stats","_removed"]),u=r(["_attachments","_replication_id","_replication_state","_replication_state_time","_replication_state_reason","_replication_stats"]);n.invalidIdError=function(e){var t;if(e?"string"!=typeof e?t=s.error(s.INVALID_ID):/^_/.test(e)&&!/^_(design|local)/.test(e)&&(t=s.error(s.RESERVED_ID)):t=s.error(s.MISSING_ID),t)throw t},n.parseDoc=function(e,t){var r,f,l,d={status:"available"};if(e._deleted&&(d.deleted=!0),t)if(e._id||(e._id=a()),f=a(32,16).toLowerCase(),e._rev){if(l=o(e._rev),l.error)return l;e._rev_tree=[{pos:l.prefix,ids:[l.id,{status:"missing"},[[f,d,[]]]]}],r=l.prefix+1}else e._rev_tree=[{pos:1,ids:[f,d,[]]}],r=1;else if(e._revisions&&(e._rev_tree=i(e._revisions,d),r=e._revisions.start,f=e._revisions.ids[0]),!e._rev_tree){if(l=o(e._rev),l.error)return l;r=l.prefix,f=l.id,e._rev_tree=[{pos:r,ids:[f,d,[]]}]}n.invalidIdError(e._id),e._rev=r+"-"+f;var p={metadata:{},data:{}};for(var h in e)if(e.hasOwnProperty(h)){var v="_"===h[0];if(v&&!c[h]){var m=s.error(s.DOC_VALIDATION,h);throw m.message=s.DOC_VALIDATION.message+": "+h,m}v&&!u[h]?p.metadata[h.slice(1)]=e[h]:p.data[h]=e[h]}return p}},{24:24,34:34}],29:[function(e,t,n){"use strict";function r(e){return decodeURIComponent(window.escape(e))}function o(e){return 65>e?e-48:e-55}function i(e,t,n){for(var r="";n>t;)r+=String.fromCharCode(o(e.charCodeAt(t++))<<4|o(e.charCodeAt(t++)));return r}function s(e,t,n){for(var r="";n>t;)r+=String.fromCharCode(o(e.charCodeAt(t+2))<<12|o(e.charCodeAt(t+3))<<8|o(e.charCodeAt(t))<<4|o(e.charCodeAt(t+1))),t+=4;return r}function a(e,t){return"UTF-8"===t?r(i(e,0,e.length)):s(e,0,e.length)}t.exports=a},{}],30:[function(e,t,n){"use strict";function r(e){for(var t=o,n=t.parser[t.strictMode?"strict":"loose"].exec(e),r={},i=14;i--;){var s=t.key[i],a=n[i]||"",c=-1!==["user","password"].indexOf(s);r[s]=c?decodeURIComponent(a):a}return r[t.q.name]={},r[t.key[12]].replace(t.q.parser,function(e,n,o){n&&(r[t.q.name][n]=o)}),r}var o={strictMode:!1,key:["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"],q:{name:"queryKey",parser:/(?:^|&)([^&=]*)=?([^&]*)/g},parser:{strict:/^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?))?((((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/,loose:/^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/}};t.exports=r},{}],31:[function(e,t,n){"use strict";"function"==typeof Promise?t.exports=Promise:t.exports=e(61)},{61:61}],32:[function(e,t,n){"use strict";function r(){for(var e={},t=new c.Promise(function(t,n){e.resolve=t,e.reject=n}),n=new Array(arguments.length),r=0;r<n.length;r++)n[r]=arguments[r];return e.promise=t,c.Promise.resolve().then(function(){return fetch.apply(null,n)}).then(function(t){e.resolve(t)})["catch"](function(t){e.reject(t)}),e}function o(e,t){var n,o,i,s=new Headers,a={method:e.method,credentials:"include",headers:s};return e.json&&(s.set("Accept","application/json"),s.set("Content-Type",e.headers["Content-Type"]||"application/json")),e.body&&e.body instanceof Blob?u(e.body,function(e){a.body=e}):e.body&&e.processData&&"string"!=typeof e.body?a.body=JSON.stringify(e.body):"body"in e?a.body=e.body:a.body=null,Object.keys(e.headers).forEach(function(t){e.headers.hasOwnProperty(t)&&s.set(t,e.headers[t])}),n=r(e.url,a),e.timeout>0&&(o=setTimeout(function(){n.reject(new Error("Load timeout for resource: "+e.url))},e.timeout)),n.promise.then(function(t){return i={statusCode:t.status},e.timeout>0&&clearTimeout(o),i.statusCode>=200&&i.statusCode<300?e.binary?t.blob():t.text():t.json()}).then(function(e){i.statusCode>=200&&i.statusCode<300?t(null,i,e):t(e,i)})["catch"](function(e){t(e,i)}),{abort:n.reject}}function i(e,t){var n,r,o,i=function(){n.abort()};if(n=e.xhr?new e.xhr:new XMLHttpRequest,"GET"===e.method&&!e.cache){var s=-1!==e.url.indexOf("?");e.url+=(s?"&":"?")+"_nonce="+Date.now()}n.open(e.method,e.url),n.withCredentials=!0,"GET"===e.method?delete e.headers["Content-Type"]:e.json&&(e.headers.Accept="application/json",e.headers["Content-Type"]=e.headers["Content-Type"]||"application/json",e.body&&e.processData&&"string"!=typeof e.body&&(e.body=JSON.stringify(e.body))),e.binary&&(n.responseType="arraybuffer"),"body"in e||(e.body=null);for(var c in e.headers)e.headers.hasOwnProperty(c)&&n.setRequestHeader(c,e.headers[c]);return e.timeout>0&&(r=setTimeout(i,e.timeout),n.onprogress=function(){clearTimeout(r),r=setTimeout(i,e.timeout)},"undefined"==typeof o&&(o=-1!==Object.keys(n).indexOf("upload")&&"undefined"!=typeof n.upload),o&&(n.upload.onprogress=n.onprogress)),n.onreadystatechange=function(){if(4===n.readyState){var r={statusCode:n.status};if(n.status>=200&&n.status<300){var o;o=e.binary?a([n.response||""],{type:n.getResponseHeader("Content-Type")}):n.responseText,t(null,r,o)}else{var i={};try{i=JSON.parse(n.response)}catch(s){}t(i,r)}}},e.body&&e.body instanceof Blob?u(e.body,function(e){n.send(e)}):n.send(e.body),{abort:i}}function s(){try{return new XMLHttpRequest,!0}catch(e){return!1}}var a=e(20),c=e(48),u=e(21),f=s();t.exports=function(e,t){return f||e.xhr?i(e,t):o(e,t)}},{20:20,21:21,48:48}],33:[function(e,t,n){"use strict";var r=e(86).upsert;t.exports=function(e,t,n,o){return r.call(e,t,n,o)}},{86:86}],34:[function(e,t,n){"use strict";function r(e){return 0|Math.random()*e}function o(e,t){t=t||i.length;var n="",o=-1;if(e){for(;++o<e;)n+=i[r(t)];return n}for(;++o<36;)switch(o){case 8:case 13:case 18:case 23:n+="-";break;case 19:n+=i[3&r(16)|8];break;default:n+=i[r(16)]}return n}var i="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("");t.exports=o},{}],35:[function(_dereq_,module,exports){"use strict";function evalFilter(input){return eval(["(function () { return ",input," })()"].join(""))}module.exports=evalFilter},{}],36:[function(_dereq_,module,exports){"use strict";function evalView(input){return eval(["(function () {","  return function (doc) {","    var emitted = false;","    var emit = function (a, b) {","      emitted = true;","    };","    var view = "+input+";","    view(doc);","    if (emitted) {","      return true;","    }","  }","})()"].join("\n"))}module.exports=evalView},{}],37:[function(e,t,n){"use strict";function r(e,t,n){for(var r,o=0,i=e.length;i>o;)r=o+i>>>1,n(e[r],t)<0?o=r+1:i=r;return o}function o(e,t,n){var o=r(e,t,n);e.splice(o,0,t)}function i(e){for(var t,n=e.shift(),r=[n.id,n.opts,[]],o=r;e.length;)n=e.shift(),t=[n.id,n.opts,[]],o[2].push(t),o=t;return r}function s(e,t){return e[0]<t[0]?-1:1}function a(e,t){for(var n=[{tree1:e,tree2:t}],r=!1;n.length>0;){var i=n.pop(),a=i.tree1,c=i.tree2;(a[1].status||c[1].status)&&(a[1].status="available"===a[1].status||"available"===c[1].status?"available":"missing");for(var u=0;u<c[2].length;u++)if(a[2][0]){for(var f=!1,l=0;l<a[2].length;l++)a[2][l][0]===c[2][u][0]&&(n.push({tree1:a[2][l],tree2:c[2][u]}),f=!0);f||(r="new_branch",o(a[2],c[2][u],s))}else r="new_leaf",a[2][0]=c[2][u]}return{conflicts:r,tree:e}}function c(e,t,n){var r,o=[],i=!1,s=!1;return e.length?(e.forEach(function(e){if(e.pos===t.pos&&e.ids[0]===t.ids[0])r=a(e.ids,t.ids),o.push({pos:e.pos,ids:r.tree}),i=i||r.conflicts,s=!0;else if(n!==!0){var c=e.pos<t.pos?e:t,u=e.pos<t.pos?t:e,f=u.pos-c.pos,l=[],d=[];for(d.push({ids:c.ids,diff:f,parent:null,parentIdx:null});d.length>0;){var p=d.pop();0!==p.diff?p.ids&&p.ids[2].forEach(function(e,t){d.push({ids:e,diff:p.diff-1,parent:p.ids,parentIdx:t})}):p.ids[0]===u.ids[0]&&l.push(p)}var h=l[0];h?(r=a(h.ids,u.ids),h.parent[2][h.parentIdx]=r.tree,o.push({pos:c.pos,ids:c.ids}),i=i||r.conflicts,s=!0):o.push(e)}else o.push(e)}),s||o.push(t),o.sort(function(e,t){return e.pos-t.pos}),{tree:o,conflicts:i||"internal_node"}):{tree:[t],conflicts:"new_leaf"}}function u(e,t){var n=l.rootToLeaf(e).map(function(e){var n=e.ids.slice(-t);return{pos:e.pos+(e.ids.length-n.length),ids:i(n)}});return n.reduce(function(e,t){return c(e,t,!0).tree},[n.shift()])}var f=e(79),l={};l.merge=function(e,t,n){e=f(!0,[],e),t=f(!0,{},t);var r=c(e,t);return{tree:u(r.tree,n),conflicts:r.conflicts}},l.winningRev=function(e){var t=[];return l.traverseRevTree(e.rev_tree,function(e,n,r,o,i){e&&t.push({pos:n,id:r,deleted:!!i.deleted})}),t.sort(function(e,t){return e.deleted!==t.deleted?e.deleted>t.deleted?1:-1:e.pos!==t.pos?t.pos-e.pos:e.id<t.id?1:-1}),t[0].pos+"-"+t[0].id},l.traverseRevTree=function(e,t){for(var n,r=e.slice();n=r.pop();)for(var o=n.pos,i=n.ids,s=i[2],a=t(0===s.length,o,i[0],n.ctx,i[1]),c=0,u=s.length;u>c;c++)r.push({pos:o+1,ids:s[c],ctx:a})},l.collectLeaves=function(e){var t=[];return l.traverseRevTree(e,function(e,n,r,o,i){e&&t.push({rev:n+"-"+r,pos:n,opts:i})}),t.sort(function(e,t){return t.pos-e.pos}),t.forEach(function(e){delete e.pos}),t},l.collectConflicts=function(e){var t=l.winningRev(e),n=l.collectLeaves(e.rev_tree),r=[];return n.forEach(function(e){e.rev===t||e.opts.deleted||r.push(e.rev)}),r},l.rootToLeaf=function(e){var t=[];return l.traverseRevTree(e,function(e,n,r,o,i){if(o=o?o.slice(0):[],o.push({id:r,opts:i}),e){var s=n+1-o.length;t.unshift({pos:s,ids:o})}return o}),t},t.exports=l},{79:79}],38:[function(e,t,n){"use strict";function r(e,t){e=parseInt(e,10),t=parseInt(t,10),e!==e&&(e=0),t!==t||e>=t?t=(e||1)<<1:t+=1;var n=Math.random(),r=t-e;return~~(r*n+e)}function o(e){var t=0;return e||(t=2e3),r(e,t)}function i(e,t,n,r){return e.retry===!1?(t.emit("error",n),void t.removeAllListeners()):("function"!=typeof e.back_off_function&&(e.back_off_function=o),t.emit("requestError",n),"active"===t.state&&(t.emit("paused",n),t.state="stopped",t.once("active",function(){e.current_back_off=s})),e.current_back_off=e.current_back_off||s,e.current_back_off=e.back_off_function(e.current_back_off),void setTimeout(r,e.current_back_off))}var s=0;t.exports=i},{}],39:[function(e,t,n){"use strict";function r(e,t,n,o){return e.get(t)["catch"](function(n){if(404===n.status)return"http"===e.type()&&s("PouchDB is just checking if a remote checkpoint exists."),{_id:t};throw n}).then(function(i){return o.cancelled?void 0:(i.last_seq=n,e.put(i)["catch"](function(i){if(409===i.status)return r(e,t,n,o);throw i}))})}function o(e,t,n,r){this.src=e,this.target=t,this.id=n,this.returnValue=r}var i=e(31),s=e(25),a=e(76),c=a.collate;o.prototype.writeCheckpoint=function(e){var t=this;return this.updateTarget(e).then(function(){return t.updateSource(e)})},o.prototype.updateTarget=function(e){return r(this.target,this.id,e,this.returnValue)},o.prototype.updateSource=function(e){var t=this;return this.readOnlySource?i.resolve(!0):r(this.src,this.id,e,this.returnValue)["catch"](function(e){var n="number"==typeof e.status&&4===Math.floor(e.status/100);if(n)return t.readOnlySource=!0,!0;throw e})},o.prototype.getCheckpoint=function(){var e=this;return e.target.get(e.id).then(function(t){return e.src.get(e.id).then(function(e){return 0===c(t.last_seq,e.last_seq)?e.last_seq:0},function(n){if(404===n.status&&t.last_seq)return e.src.put({_id:e.id,last_seq:0}).then(function(){return 0},function(n){return 401===n.status?(e.readOnlySource=!0,t.last_seq):0});throw n})})["catch"](function(e){if(404!==e.status)throw e;return 0})},t.exports=o},{25:25,31:31,76:76}],40:[function(e,t,n){"use strict";function r(e,t,n){var r=n.filter?n.filter.toString():"";return e.id().then(function(e){return t.id().then(function(t){var i=e+t+r+JSON.stringify(n.query_params)+n.doc_ids;return o.MD5(i).then(function(e){return e=e.replace(/\//g,".").replace(/\+/g,"_"),"_local/"+e})})})}var o=e(48);t.exports=r},{48:48}],41:[function(e,t,n){"use strict";function r(e){return/^1-/.test(e)}function o(e,t,n){function o(t,r){var o={revs:!0,open_revs:r,attachments:!0};return e.get(t,o).then(function(e){if(n.cancelled)throw new Error("cancelled");e.forEach(function(e){e.ok&&h.push(e.ok)})})}function i(e){for(var n=t[e].missing,r=[],i=0;i<n.length;i+=c){var s=n.slice(i,Math.min(n.length,i+c));r.push(s)}return a.all(r.map(function(t){return o(e,t)}))}function u(){var e=Object.keys(t);return a.all(e.map(i))}function f(e){return e._attachments&&Object.keys(e._attachments).length>0}function l(o){return e.allDocs({keys:o,include_docs:!0}).then(function(e){if(n.cancelled)throw new Error("cancelled");e.rows.forEach(function(e){!e.deleted&&e.doc&&r(e.value.rev)&&!f(e.doc)&&(h.push(e.doc),delete t[e.id])})})}function d(){var e=Object.keys(t).filter(function(e){var n=t[e].missing;return 1===n.length&&r(n[0])});return e.length>0?l(e):void 0}function p(){return h}t=s(t);var h=[];return a.resolve().then(d).then(u).then(p)}var i=e(48),s=i.clone,a=i.Promise,c=50;t.exports=o},{48:48}],42:[function(e,t,n){"use strict";function r(e,t){var n=t.PouchConstructor;return"string"==typeof e?new n(e,t):e}function o(e,t,n,o){"function"==typeof n&&(o=n,n={}),"undefined"==typeof n&&(n={}),n.complete||(n.complete=o||function(){}),n=i.clone(n),n.continuous=n.continuous||n.live,n.retry="retry"in n?n.retry:!1,n.PouchConstructor=n.PouchConstructor||this;var c=new a(n),u=r(e,n),f=r(t,n);return s(u,f,n,c),c}var i=e(48),s=e(43),a=e(44);t.exports={replicate:o,toPouch:r}},{43:43,44:44,48:48}],43:[function(e,t,n){"use strict";function r(e,t,n,u,f){function l(){return A?o.Promise.resolve():a(e,t,n).then(function(n){O=n,A=new i(e,t,O,M)})}function d(){if(0!==x.docs.length){var e=x.docs;return t.bulkDocs({docs:e,new_edits:!1}).then(function(t){if(M.cancelled)throw y(),new Error("cancelled");var n=[],r={};t.forEach(function(e){e.error&&(f.doc_write_failures++,n.push(e),r[e.id]=e)}),P=P.concat(n),f.docs_written+=x.docs.length-n.length;var i=n.filter(function(e){return"unauthorized"!==e.name&&"forbidden"!==e.name});if(U=[],e.forEach(function(e){var t=r[e._id];t?u.emit("denied",o.clone(t)):U.push(e)}),i.length>0){var s=new Error("bulkDocs error");throw s.other_errors=n,g("target.bulkDocs failed to write docs",s),new Error("bulkWrite partial failure")}},function(t){throw f.doc_write_failures+=e.length,t})}}function p(){return R=!0,A.writeCheckpoint(x.seq).then(function(){if(R=!1,M.cancelled)throw y(),new Error("cancelled");f.last_seq=I=x.seq;var e=o.clone(f);e.docs=U,u.emit("change",e),x=void 0,S()})["catch"](function(e){throw R=!1,g("writeCheckpoint completed with error",e),e})}function h(){var e={};return x.changes.forEach(function(t){"_user/"!==t.id&&(e[t.id]=t.changes.map(function(e){return e.rev}))}),t.revsDiff(e).then(function(e){if(M.cancelled)throw y(),new Error("cancelled");x.diffs=e})}function v(){return c(e,x.diffs,M).then(function(e){e.forEach(function(e){delete x.diffs[e._id],f.docs_read++,x.docs.push(e)})})}function m(){if(!M.cancelled&&!x){if(0===k.length)return void _(!0);x=k.shift(),h().then(v).then(d).then(p).then(m)["catch"](function(e){g("batch processing terminated with error",e)})}}function _(e){return 0===q.changes.length?void(0!==k.length||x||((L&&J.live||C)&&(u.state="pending",u.emit("paused"),u.emit("uptodate",f)),C&&y())):void((e||C||q.changes.length>=N)&&(k.push(q),q={seq:0,changes:[],docs:[]},("pending"===u.state||"stopped"===u.state)&&(u.state="active",u.emit("active")),m()))}function g(e,t){D||(t.message||(t.message=e),f.ok=!1,f.status="aborting",f.errors.push(t),P=P.concat(t),k=[],q={seq:0,changes:[],docs:[]},y())}function y(){if(!(D||M.cancelled&&(f.status="cancelled",R))){f.status=f.status||"complete",f.end_time=new Date,f.last_seq=I,D=M.cancelled=!0;var o=P.filter(function(e){return"unauthorized"!==e.name&&"forbidden"!==e.name});if(o.length>0){var i=P.pop();P.length>0&&(i.other_errors=P),i.result=f,s(n,u,i,function(){r(e,t,n,u)})}else f.errors=P,u.emit("complete",f),u.removeAllListeners()}}function b(e){if(M.cancelled)return y();var t=o.filterChange(n)(e);t&&(q.seq=e.seq,q.changes.push(e),_(0===k.length))}function E(e){return B=!1,M.cancelled?y():(e.results.length>0?(J.since=e.last_seq,S()):L?(J.live=!0,S()):C=!0,void _(!0))}function w(e){return B=!1,M.cancelled?y():void g("changes rejected",e)}function S(){function t(){o.cancel()}function r(){u.removeListener("cancel",t)}if(!B&&!C&&k.length<j){B=!0,u._changes&&(u.removeListener("cancel",u._abortChanges),u._changes.cancel()),u.once("cancel",t);var o=e.changes(J).on("change",b);o.then(r,r),o.then(E)["catch"](w),n.retry&&(u._changes=o,u._abortChanges=t)}}function T(){l().then(function(){return M.cancelled?void y():A.getCheckpoint().then(function(e){I=e,J={since:I,limit:N,batch_size:N,style:"all_docs",doc_ids:F,returnDocs:!0},n.filter&&("string"!=typeof n.filter?J.include_docs=!0:J.filter=n.filter),n.query_params&&(J.query_params=n.query_params),n.view&&(J.view=n.view),S()})})["catch"](function(e){g("getCheckpoint rejected with ",e)})}var x,O,A,k=[],q={seq:0,changes:[],docs:[]},R=!1,C=!1,D=!1,I=0,L=n.continuous||n.live||!1,N=n.batch_size||100,j=n.batches_limit||10,B=!1,F=n.doc_ids,M={cancelled:!1},P=[],U=[];f=f||{ok:!0,start_time:new Date,docs_read:0,docs_written:0,doc_write_failures:0,errors:[]};var J={};return u.ready(e,t),u.cancelled?void y():(u._addedListeners||(u.once("cancel",y),"function"==typeof n.onChange&&u.on("change",n.onChange),"function"==typeof n.complete&&(u.once("error",n.complete),u.once("complete",function(e){n.complete(null,e)})),u._addedListeners=!0),void("undefined"==typeof n.since?T():l().then(function(){return R=!0,A.writeCheckpoint(n.since)}).then(function(){return R=!1,M.cancelled?void y():(I=n.since,void T())})["catch"](function(e){throw R=!1,g("writeCheckpoint completed with error",e),e})))}var o=e(48),i=e(39),s=e(38),a=e(40),c=e(41);t.exports=r},{38:38,39:39,40:40,41:41,48:48}],44:[function(e,t,n){"use strict";function r(){i.call(this),this.cancelled=!1,this.state="pending";var e=this,t=new s(function(t,n){e.once("complete",t),e.once("error",n)});e.then=function(e,n){return t.then(e,n)},e["catch"]=function(e){return t["catch"](e)},e["catch"](function(){})}var o=e(48),i=e(52).EventEmitter,s=o.Promise;o.inherits(r,i),r.prototype.cancel=function(){this.cancelled=!0,this.state="cancelled",this.emit("cancel")},r.prototype.ready=function(e,t){function n(){o.cancel()}function r(){e.removeListener("destroyed",n),t.removeListener("destroyed",n)}var o=this;o._readyCalled||(o._readyCalled=!0,e.once("destroyed",n),t.once("destroyed",n),o.once("complete",r))},t.exports=r},{48:48,52:52}],45:[function(e,t,n){"use strict";var r=e(14),o=e(48),i=e(52).EventEmitter;r.adapters={},r.preferredAdapters=[],r.prefix="_pouch_";var s=new i,a=["on","addListener","emit","listeners","once","removeAllListeners","removeListener","setMaxListeners"];a.forEach(function(e){r[e]=s[e].bind(s)}),r.setMaxListeners(0),r.parseAdapter=function(e,t){var n,i,s=e.match(/([a-z\-]*):\/\/(.*)/);if(s){if(e=/http(s?)/.test(s[1])?s[1]+"://"+s[2]:s[2],n=s[1],!r.adapters[n].valid())throw"Invalid adapter";return{name:e,adapter:s[1]}}var a="idb"in r.adapters&&"websql"in r.adapters&&o.hasLocalStorage()&&localStorage["_pouch__websqldb_"+r.prefix+e];if(t.adapter)i=t.adapter;else if("undefined"!=typeof t&&t.db)i="leveldb";else for(var c=0;c<r.preferredAdapters.length;++c)if(i=r.preferredAdapters[c],i in r.adapters){if(a&&"idb"===i){console.log('PouchDB is downgrading "'+e+'" to WebSQL to avoid data loss, because it was already opened with WebSQL.');continue}break}n=r.adapters[i];var u=n&&"use_prefix"in n?n.use_prefix:!0;return{name:u?r.prefix+e:e,adapter:i}},r.destroy=o.toPromise(function(e,t,n){console.log("PouchDB.destroy() is deprecated and will be removed. Please use db.destroy() instead."),("function"==typeof t||"undefined"==typeof t)&&(n=t,t={}),e&&"object"==typeof e&&(t=e,e=void 0),new r(e,t,function(e,t){return e?n(e):void t.destroy(n)})}),r.adapter=function(e,t,n){t.valid()&&(r.adapters[e]=t,n&&r.preferredAdapters.push(e))},r.plugin=function(e){Object.keys(e).forEach(function(t){r.prototype[t]=e[t]})},r.defaults=function(e){function t(t,n,i){("function"==typeof n||"undefined"==typeof n)&&(i=n,n={}),t&&"object"==typeof t&&(n=t,t=void 0),n=o.extend(!0,{},e,n),r.call(this,t,n,i)}return o.inherits(t,r),t.destroy=o.toPromise(function(t,n,i){return("function"==typeof n||"undefined"==typeof n)&&(i=n,n={}),t&&"object"==typeof t&&(n=t,t=void 0),n=o.extend(!0,{},e,n),r.destroy(t,n,i)}),a.forEach(function(e){t[e]=s[e].bind(s)}),t.setMaxListeners(10),t.preferredAdapters=r.preferredAdapters.slice(),Object.keys(r).forEach(function(e){e in t||(t[e]=r[e])}),t},t.exports=r},{14:14,48:48,52:52}],46:[function(e,t,n){"use strict";function r(e,t,n,r){return"function"==typeof n&&(r=n,n={}),"undefined"==typeof n&&(n={}),n=i.clone(n),n.PouchConstructor=n.PouchConstructor||this,e=s.toPouch(e,n),t=s.toPouch(t,n),new o(e,t,n,r);
}function o(e,t,n,r){function o(e){v||(v=!0,d.emit("cancel",e))}function s(e){d.emit("change",{direction:"pull",change:e})}function c(e){d.emit("change",{direction:"push",change:e})}function u(e){d.emit("denied",{direction:"push",doc:e})}function f(e){d.emit("denied",{direction:"pull",doc:e})}function l(e){return function(t,n){var r="change"===t&&(n===s||n===c),i="cancel"===t&&n===o,a=t in m&&n===m[t];(r||i||a)&&(t in _||(_[t]={}),_[t][e]=!0,2===Object.keys(_[t]).length&&d.removeAllListeners(t))}}var d=this;this.canceled=!1;var p,h;"onChange"in n&&(p=n.onChange,delete n.onChange),"function"!=typeof r||n.complete?"complete"in n&&(h=n.complete,delete n.complete):h=r,this.push=a(e,t,n),this.pull=a(t,e,n);var v=!1,m={},_={};n.live&&(this.push.on("complete",d.pull.cancel.bind(d.pull)),this.pull.on("complete",d.push.cancel.bind(d.push))),this.on("newListener",function(e){"change"===e?(d.pull.on("change",s),d.push.on("change",c)):"denied"===e?(d.pull.on("denied",f),d.push.on("denied",u)):"cancel"===e?(d.pull.on("cancel",o),d.push.on("cancel",o)):"error"===e||"removeListener"===e||"complete"===e||e in m||(m[e]=function(t){d.emit(e,t)},d.pull.on(e,m[e]),d.push.on(e,m[e]))}),this.on("removeListener",function(e){"change"===e?(d.pull.removeListener("change",s),d.push.removeListener("change",c)):"cancel"===e?(d.pull.removeListener("cancel",o),d.push.removeListener("cancel",o)):e in m&&"function"==typeof m[e]&&(d.pull.removeListener(e,m[e]),d.push.removeListener(e,m[e]),delete m[e])}),this.pull.on("removeListener",l("pull")),this.push.on("removeListener",l("push"));var g=i.Promise.all([this.push,this.pull]).then(function(e){var t={push:e[0],pull:e[1]};return d.emit("complete",t),h&&h(null,t),d.removeAllListeners(),t},function(e){throw d.cancel(),d.emit("error",e),h&&h(e),d.removeAllListeners(),e});this.then=function(e,t){return g.then(e,t)},this["catch"]=function(e){return g["catch"](e)}}var i=e(48),s=e(42),a=s.replicate,c=e(52).EventEmitter;i.inherits(o,c),t.exports=r,o.prototype.cancel=function(){this.canceled||(this.canceled=!0,this.push.cancel(),this.pull.cancel())}},{42:42,48:48,52:52}],47:[function(e,t,n){"use strict";function r(){this.isReady=!1,this.failed=!1,this.queue=[]}t.exports=r,r.prototype.execute=function(){var e,t;if(this.failed)for(;e=this.queue.shift();)"function"!=typeof e?(t=e.parameters[e.parameters.length-1],"function"==typeof t?t(this.failed):"changes"===e.name&&"function"==typeof t.complete&&t.complete(this.failed)):e(this.failed);else if(this.isReady)for(;e=this.queue.shift();)"function"==typeof e?e():e.task=this.db[e.name].apply(this.db,e.parameters)},r.prototype.fail=function(e){this.failed=e,this.execute()},r.prototype.ready=function(e){return this.failed?!1:0===arguments.length?this.isReady:(this.isReady=e?!0:!1,this.db=e,void this.execute())},r.prototype.addTask=function(e,t){if("function"!=typeof e){var n={name:e,parameters:t};return this.queue.push(n),this.failed&&this.execute(),n}this.queue.push(e),this.failed&&this.execute()}},{}],48:[function(e,t,n){(function(t){function r(){return"undefined"!=typeof chrome&&"undefined"!=typeof chrome.storage&&"undefined"!=typeof chrome.storage.local}function o(){if(!(this instanceof o))return new o;var e=this;a.call(this),this.isChrome=r(),this._listeners={},this.hasLocal=!1,this.isChrome||(this.hasLocal=n.hasLocalStorage()),this.isChrome?chrome.storage.onChanged.addListener(function(t){null!=t.db_name&&e.emit(t.dbName.newValue)}):this.hasLocal&&("undefined"!=typeof addEventListener?addEventListener("storage",function(t){e.emit(t.key)}):window.attachEvent("storage",function(t){e.emit(t.key)}))}var i=e(37);n.extend=e(79),n.ajax=e(15),n.createBlob=e(20),n.uuid=e(34),n.getArguments=e(50);var s=e(24),a=e(52).EventEmitter,c=e(78);n.Map=c.Map,n.Set=c.Set;var u=e(28),f=e(31);n.Promise=f;var l=e(17);n.atob=l.atob,n.btoa=l.btoa;var d=e(19),p=e(16),h=e(21);n.binaryStringToBlob=d,n.lastIndexOf=function(e,t){for(var n=e.length-1;n>=0;n--)if(e.charAt(n)===t)return n;return-1},n.clone=function(e){return n.extend(!0,{},e)},n.pick=function(e,t){for(var n={},r=0,o=t.length;o>r;r++){var i=t[r];n[i]=e[i]}return n},n.inherits=e(57),n.call=n.getArguments(function(e){if(e.length){var t=e.shift();"function"==typeof t&&t.apply(this,e)}}),n.isLocalId=function(e){return/^_local/.test(e)},n.isDeleted=function(e,t){t||(t=i.winningRev(e));var n=t.indexOf("-");-1!==n&&(t=t.substring(n+1));var r=!1;return i.traverseRevTree(e.rev_tree,function(e,n,o,i,s){o===t&&(r=!!s.deleted)}),r},n.revExists=function(e,t){var n=!1;return i.traverseRevTree(e.rev_tree,function(e,r,o){r+"-"+o===t&&(n=!0)}),n},n.filterChange=function(e){var t={},n=e.filter&&"function"==typeof e.filter;return t.query=e.query_params,function(r){if(r.doc||(r.doc={}),e.filter&&n&&!e.filter.call(this,r.doc,t))return!1;if(e.include_docs){if(!e.attachments)for(var o in r.doc._attachments)r.doc._attachments.hasOwnProperty(o)&&(r.doc._attachments[o].stub=!0)}else delete r.doc;return!0}},n.parseDoc=u.parseDoc,n.invalidIdError=u.invalidIdError,n.isCordova=function(){return"undefined"!=typeof cordova||"undefined"!=typeof PhoneGap||"undefined"!=typeof phonegap},n.hasLocalStorage=function(){if(r())return!1;try{return localStorage}catch(e){return!1}},n.Changes=o,n.inherits(o,a),o.prototype.addListener=function(e,r,o,i){function s(){if(a._listeners[r]){if(c)return void(c="waiting");c=!0,o.changes({style:i.style,include_docs:i.include_docs,attachments:i.attachments,conflicts:i.conflicts,continuous:!1,descending:!1,filter:i.filter,doc_ids:i.doc_ids,view:i.view,since:i.since,query_params:i.query_params}).on("change",function(e){e.seq>i.since&&!i.cancelled&&(i.since=e.seq,n.call(i.onChange,e))}).on("complete",function(){"waiting"===c&&t.nextTick(function(){a.notify(e)}),c=!1}).on("error",function(){c=!1})}}if(!this._listeners[r]){var a=this,c=!1;this._listeners[r]=s,this.on(e,s)}},o.prototype.removeListener=function(e,t){t in this._listeners&&a.prototype.removeListener.call(this,e,this._listeners[t])},o.prototype.notifyLocalWindows=function(e){this.isChrome?chrome.storage.local.set({dbName:e}):this.hasLocal&&(localStorage[e]="a"===localStorage[e]?"b":"a")},o.prototype.notify=function(e){this.emit(e),this.notifyLocalWindows(e)},n.once=function(e){var t=!1;return n.getArguments(function(n){if(t)throw new Error("once called  more than once");t=!0,e.apply(this,n)})},n.toPromise=function(e){return n.getArguments(function(r){var o,i=this,s="function"==typeof r[r.length-1]?r.pop():!1;s&&(o=function(e,n){t.nextTick(function(){s(e,n)})});var a=new f(function(t,o){var s;try{var a=n.once(function(e,n){e?o(e):t(n)});r.push(a),s=e.apply(i,r),s&&"function"==typeof s.then&&t(s)}catch(c){o(c)}});return o&&a.then(function(e){o(null,e)},o),a.cancel=function(){return this},a})},n.adapterFun=function(t,r){function o(e,t,n){if(i.enabled){for(var r=[e._db_name,t],o=0;o<n.length-1;o++)r.push(n[o]);i.apply(null,r);var s=n[n.length-1];n[n.length-1]=function(n,r){var o=[e._db_name,t];o=o.concat(n?["error",n]:["success",r]),i.apply(null,o),s(n,r)}}}var i=e(54)("pouchdb:api");return n.toPromise(n.getArguments(function(e){if(this._closed)return f.reject(new Error("database is closed"));var n=this;return o(n,t,e),this.taskqueue.isReady?r.apply(this,e):new f(function(r,o){n.taskqueue.addTask(function(i){i?o(i):r(n[t].apply(n,e))})})}))},n.cancellableFun=function(e,t,r){r=r?n.clone(!0,{},r):{};var o=new a,i=r.complete||function(){},s=r.complete=n.once(function(e,t){e?i(e):(o.emit("end",t),i(null,t)),o.removeAllListeners()}),c=r.onChange||function(){},u=0;t.on("destroyed",function(){o.removeAllListeners()}),r.onChange=function(e){c(e),e.seq<=u||(u=e.seq,o.emit("change",e),e.deleted?o.emit("delete",e):1===e.changes.length&&"1-"===e.changes[0].rev.slice(0,1)?o.emit("create",e):o.emit("update",e))};var l=new f(function(e,t){r.complete=function(n,r){n?t(n):e(r)}});return l.then(function(e){s(null,e)},s),l.cancel=function(){l.isCancelled=!0,t.taskqueue.isReady&&r.complete(null,{status:"cancelled"})},t.taskqueue.isReady?e(t,r,l):t.taskqueue.addTask(function(){l.isCancelled?r.complete(null,{status:"cancelled"}):e(t,r,l)}),l.on=o.on.bind(o),l.once=o.once.bind(o),l.addListener=o.addListener.bind(o),l.removeListener=o.removeListener.bind(o),l.removeAllListeners=o.removeAllListeners.bind(o),l.setMaxListeners=o.setMaxListeners.bind(o),l.listeners=o.listeners.bind(o),l.emit=o.emit.bind(o),l},n.MD5=n.toPromise(e(26)),n.explain404=e(25),n.info=function(e){"undefined"!=typeof console&&"info"in console&&console.info(e)},n.parseUri=e(30),n.compare=function(e,t){return t>e?-1:e>t?1:0},n.updateDoc=function(e,t,r,o,a,c,u){if(n.revExists(e,t.metadata.rev))return r[o]=t,a();var f=i.winningRev(e),l=n.isDeleted(e,f),d=n.isDeleted(t.metadata),p=/^1-/.test(t.metadata.rev);if(l&&!d&&u&&p){var h=t.data;h._rev=f,h._id=t.metadata.id,t=n.parseDoc(h,u)}var v=i.merge(e.rev_tree,t.metadata.rev_tree[0],1e3),m=u&&(l&&d||!l&&"new_leaf"!==v.conflicts||l&&!d&&"new_branch"===v.conflicts);if(m){var _=s.error(s.REV_CONFLICT);return r[o]=_,a()}var g=t.metadata.rev;t.metadata.rev_tree=v.tree,e.rev_map&&(t.metadata.rev_map=e.rev_map);var y=i.winningRev(t.metadata),b=n.isDeleted(t.metadata,y),E=l===b?0:b>l?-1:1,w=n.isDeleted(t.metadata,g);c(t,y,b,w,!0,E,o,a)},n.processDocs=function(e,t,r,o,a,c,u,f){function l(e,t,r){var o=i.winningRev(e.metadata),f=n.isDeleted(e.metadata,o);if("was_delete"in u&&f)return a[t]=s.error(s.MISSING_DOC,"deleted"),r();var l=f?0:1;c(e,o,f,f,!1,l,t,r)}function d(){++v===m&&f&&f()}if(e.length){var p=u.new_edits,h=new n.Map,v=0,m=e.length;e.forEach(function(e,r){if(e._id&&n.isLocalId(e._id))return void t[e._deleted?"_removeLocal":"_putLocal"](e,{ctx:o},function(e){e?a[r]=e:a[r]={ok:!0},d()});var i=e.metadata.id;h.has(i)?(m--,h.get(i).push([e,r])):h.set(i,[[e,r]])}),h.forEach(function(e,t){function o(){++s<e.length?i():d()}function i(){var i=e[s],u=i[0],f=i[1];r.has(t)?n.updateDoc(r.get(t),u,a,f,o,c,p):l(u,f,o)}var s=0;i()})}},n.preprocessAttachments=function(e,t,r){function o(e){try{return l.atob(e)}catch(t){var n=s.error(s.BAD_ARG,"Attachments need to be base64 encoded");return{error:n}}}function i(e,r){if(e.stub)return r();if("string"==typeof e.data){var i=o(e.data);if(i.error)return r(i.error);e.length=i.length,"blob"===t?e.data=d(i,e.content_type):"base64"===t?e.data=l.btoa(i):e.data=i,n.MD5(i).then(function(t){e.digest="md5-"+t,r()})}else h(e.data,function(o){"binary"===t?e.data=p(o):"base64"===t&&(e.data=l.btoa(p(o))),n.MD5(o).then(function(t){e.digest="md5-"+t,e.length=o.byteLength,r()})})}function a(){u++,e.length===u&&(c?r(c):r())}if(!e.length)return r();var c,u=0;e.forEach(function(e){function t(e){c=e,r++,r===n.length&&a()}var n=e.data&&e.data._attachments?Object.keys(e.data._attachments):[],r=0;if(!n.length)return a();for(var o in e.data._attachments)e.data._attachments.hasOwnProperty(o)&&i(e.data._attachments[o],t)})},n.compactTree=function(e){var t=[];return i.traverseRevTree(e.rev_tree,function(e,n,r,o,i){"available"!==i.status||e||(t.push(n+"-"+r),i.status="missing")}),t};var v=e(88);n.safeJsonParse=function(e){try{return JSON.parse(e)}catch(t){return v.parse(e)}},n.safeJsonStringify=function(e){try{return JSON.stringify(e)}catch(t){return v.stringify(e)}}}).call(this,e(53))},{15:15,16:16,17:17,19:19,20:20,21:21,24:24,25:25,26:26,28:28,30:30,31:31,34:34,37:37,50:50,52:52,53:53,54:54,57:57,78:78,79:79,88:88}],49:[function(e,t,n){t.exports="3.6.0"},{}],50:[function(e,t,n){"use strict";function r(e){return function(){var t=arguments.length;if(t){for(var n=[],r=-1;++r<t;)n[r]=arguments[r];return e.call(this,n)}return e.call(this,[])}}t.exports=r},{}],51:[function(e,t,n){},{}],52:[function(e,t,n){function r(){this._events=this._events||{},this._maxListeners=this._maxListeners||void 0}function o(e){return"function"==typeof e}function i(e){return"number"==typeof e}function s(e){return"object"==typeof e&&null!==e}function a(e){return void 0===e}t.exports=r,r.EventEmitter=r,r.prototype._events=void 0,r.prototype._maxListeners=void 0,r.defaultMaxListeners=10,r.prototype.setMaxListeners=function(e){if(!i(e)||0>e||isNaN(e))throw TypeError("n must be a positive number");return this._maxListeners=e,this},r.prototype.emit=function(e){var t,n,r,i,c,u;if(this._events||(this._events={}),"error"===e&&(!this._events.error||s(this._events.error)&&!this._events.error.length)){if(t=arguments[1],t instanceof Error)throw t;throw TypeError('Uncaught, unspecified "error" event.')}if(n=this._events[e],a(n))return!1;if(o(n))switch(arguments.length){case 1:n.call(this);break;case 2:n.call(this,arguments[1]);break;case 3:n.call(this,arguments[1],arguments[2]);break;default:for(r=arguments.length,i=new Array(r-1),c=1;r>c;c++)i[c-1]=arguments[c];n.apply(this,i)}else if(s(n)){for(r=arguments.length,i=new Array(r-1),c=1;r>c;c++)i[c-1]=arguments[c];for(u=n.slice(),r=u.length,c=0;r>c;c++)u[c].apply(this,i)}return!0},r.prototype.addListener=function(e,t){var n;if(!o(t))throw TypeError("listener must be a function");if(this._events||(this._events={}),this._events.newListener&&this.emit("newListener",e,o(t.listener)?t.listener:t),this._events[e]?s(this._events[e])?this._events[e].push(t):this._events[e]=[this._events[e],t]:this._events[e]=t,s(this._events[e])&&!this._events[e].warned){var n;n=a(this._maxListeners)?r.defaultMaxListeners:this._maxListeners,n&&n>0&&this._events[e].length>n&&(this._events[e].warned=!0,console.error("(node) warning: possible EventEmitter memory leak detected. %d listeners added. Use emitter.setMaxListeners() to increase limit.",this._events[e].length),"function"==typeof console.trace&&console.trace())}return this},r.prototype.on=r.prototype.addListener,r.prototype.once=function(e,t){function n(){this.removeListener(e,n),r||(r=!0,t.apply(this,arguments))}if(!o(t))throw TypeError("listener must be a function");var r=!1;return n.listener=t,this.on(e,n),this},r.prototype.removeListener=function(e,t){var n,r,i,a;if(!o(t))throw TypeError("listener must be a function");if(!this._events||!this._events[e])return this;if(n=this._events[e],i=n.length,r=-1,n===t||o(n.listener)&&n.listener===t)delete this._events[e],this._events.removeListener&&this.emit("removeListener",e,t);else if(s(n)){for(a=i;a-->0;)if(n[a]===t||n[a].listener&&n[a].listener===t){r=a;break}if(0>r)return this;1===n.length?(n.length=0,delete this._events[e]):n.splice(r,1),this._events.removeListener&&this.emit("removeListener",e,t)}return this},r.prototype.removeAllListeners=function(e){var t,n;if(!this._events)return this;if(!this._events.removeListener)return 0===arguments.length?this._events={}:this._events[e]&&delete this._events[e],this;if(0===arguments.length){for(t in this._events)"removeListener"!==t&&this.removeAllListeners(t);return this.removeAllListeners("removeListener"),this._events={},this}if(n=this._events[e],o(n))this.removeListener(e,n);else for(;n.length;)this.removeListener(e,n[n.length-1]);return delete this._events[e],this},r.prototype.listeners=function(e){var t;return t=this._events&&this._events[e]?o(this._events[e])?[this._events[e]]:this._events[e].slice():[]},r.listenerCount=function(e,t){var n;return n=e._events&&e._events[t]?o(e._events[t])?1:e._events[t].length:0}},{}],53:[function(e,t,n){function r(){if(!a){a=!0;for(var e,t=s.length;t;){e=s,s=[];for(var n=-1;++n<t;)e[n]();t=s.length}a=!1}}function o(){}var i=t.exports={},s=[],a=!1;i.nextTick=function(e){s.push(e),a||setTimeout(r,0)},i.title="browser",i.browser=!0,i.env={},i.argv=[],i.version="",i.versions={},i.on=o,i.addListener=o,i.once=o,i.off=o,i.removeListener=o,i.removeAllListeners=o,i.emit=o,i.binding=function(e){throw new Error("process.binding is not supported")},i.cwd=function(){return"/"},i.chdir=function(e){throw new Error("process.chdir is not supported")},i.umask=function(){return 0}},{}],54:[function(e,t,n){function r(){return"WebkitAppearance"in document.documentElement.style||window.console&&(console.firebug||console.exception&&console.table)||navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)&&parseInt(RegExp.$1,10)>=31}function o(){var e=arguments,t=this.useColors;if(e[0]=(t?"%c":"")+this.namespace+(t?" %c":" ")+e[0]+(t?"%c ":" ")+"+"+n.humanize(this.diff),!t)return e;var r="color: "+this.color;e=[e[0],r,"color: inherit"].concat(Array.prototype.slice.call(e,1));var o=0,i=0;return e[0].replace(/%[a-z%]/g,function(e){"%"!==e&&(o++,"%c"===e&&(i=o))}),e.splice(i,0,r),e}function i(){return"object"==typeof console&&console.log&&Function.prototype.apply.call(console.log,console,arguments)}function s(e){try{null==e?n.storage.removeItem("debug"):n.storage.debug=e}catch(t){}}function a(){var e;try{e=n.storage.debug}catch(t){}return e}function c(){try{return window.localStorage}catch(e){}}n=t.exports=e(55),n.log=i,n.formatArgs=o,n.save=s,n.load=a,n.useColors=r,n.storage="undefined"!=typeof chrome&&"undefined"!=typeof chrome.storage?chrome.storage.local:c(),n.colors=["lightseagreen","forestgreen","goldenrod","dodgerblue","darkorchid","crimson"],n.formatters.j=function(e){return JSON.stringify(e)},n.enable(a())},{55:55}],55:[function(e,t,n){function r(){return n.colors[f++%n.colors.length]}function o(e){function t(){}function o(){var e=o,t=+new Date,i=t-(u||t);e.diff=i,e.prev=u,e.curr=t,u=t,null==e.useColors&&(e.useColors=n.useColors()),null==e.color&&e.useColors&&(e.color=r());var s=Array.prototype.slice.call(arguments);s[0]=n.coerce(s[0]),"string"!=typeof s[0]&&(s=["%o"].concat(s));var a=0;s[0]=s[0].replace(/%([a-z%])/g,function(t,r){if("%"===t)return t;a++;var o=n.formatters[r];if("function"==typeof o){var i=s[a];t=o.call(e,i),s.splice(a,1),a--}return t}),"function"==typeof n.formatArgs&&(s=n.formatArgs.apply(e,s));var c=o.log||n.log||console.log.bind(console);c.apply(e,s)}t.enabled=!1,o.enabled=!0;var i=n.enabled(e)?o:t;return i.namespace=e,i}function i(e){n.save(e);for(var t=(e||"").split(/[\s,]+/),r=t.length,o=0;r>o;o++)t[o]&&(e=t[o].replace(/\*/g,".*?"),"-"===e[0]?n.skips.push(new RegExp("^"+e.substr(1)+"$")):n.names.push(new RegExp("^"+e+"$")))}function s(){n.enable("")}function a(e){var t,r;for(t=0,r=n.skips.length;r>t;t++)if(n.skips[t].test(e))return!1;for(t=0,r=n.names.length;r>t;t++)if(n.names[t].test(e))return!0;return!1}function c(e){return e instanceof Error?e.stack||e.message:e}n=t.exports=o,n.coerce=c,n.disable=s,n.enable=i,n.enabled=a,n.humanize=e(56),n.names=[],n.skips=[],n.formatters={};var u,f=0},{56:56}],56:[function(e,t,n){function r(e){if(e=""+e,!(e.length>1e4)){var t=/^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(e);if(t){var n=parseFloat(t[1]),r=(t[2]||"ms").toLowerCase();switch(r){case"years":case"year":case"yrs":case"yr":case"y":return n*l;case"days":case"day":case"d":return n*f;case"hours":case"hour":case"hrs":case"hr":case"h":return n*u;case"minutes":case"minute":case"mins":case"min":case"m":return n*c;case"seconds":case"second":case"secs":case"sec":case"s":return n*a;case"milliseconds":case"millisecond":case"msecs":case"msec":case"ms":return n}}}}function o(e){return e>=f?Math.round(e/f)+"d":e>=u?Math.round(e/u)+"h":e>=c?Math.round(e/c)+"m":e>=a?Math.round(e/a)+"s":e+"ms"}function i(e){return s(e,f,"day")||s(e,u,"hour")||s(e,c,"minute")||s(e,a,"second")||e+" ms"}function s(e,t,n){return t>e?void 0:1.5*t>e?Math.floor(e/t)+" "+n:Math.ceil(e/t)+" "+n+"s"}var a=1e3,c=60*a,u=60*c,f=24*u,l=365.25*f;t.exports=function(e,t){return t=t||{},"string"==typeof e?r(e):t["long"]?i(e):o(e)}},{}],57:[function(e,t,n){"function"==typeof Object.create?t.exports=function(e,t){e.super_=t,e.prototype=Object.create(t.prototype,{constructor:{value:e,enumerable:!1,writable:!0,configurable:!0}})}:t.exports=function(e,t){e.super_=t;var n=function(){};n.prototype=t.prototype,e.prototype=new n,e.prototype.constructor=e}},{}],58:[function(e,t,n){"use strict";function r(){}t.exports=r},{}],59:[function(e,t,n){"use strict";function r(e){function t(e,t){function o(e){u[t]=e,++f===n&!r&&(r=!0,c.resolve(d,u))}s(e).then(o,function(e){r||(r=!0,c.reject(d,e))})}if("[object Array]"!==Object.prototype.toString.call(e))return i(new TypeError("must be an array"));var n=e.length,r=!1;if(!n)return s([]);for(var u=new Array(n),f=0,l=-1,d=new o(a);++l<n;)t(e[l],l);return d}var o=e(62),i=e(65),s=e(66),a=e(58),c=e(60);t.exports=r},{58:58,60:60,62:62,65:65,66:66}],60:[function(e,t,n){"use strict";function r(e){var t=e&&e.then;return e&&"object"==typeof e&&"function"==typeof t?function(){t.apply(e,arguments)}:void 0}var o=e(69),i=e(67),s=e(68);n.resolve=function(e,t){var a=o(r,t);if("error"===a.status)return n.reject(e,a.value);var c=a.value;if(c)i.safely(e,c);else{e.state=s.FULFILLED,e.outcome=t;for(var u=-1,f=e.queue.length;++u<f;)e.queue[u].callFulfilled(t)}return e},n.reject=function(e,t){e.state=s.REJECTED,e.outcome=t;for(var n=-1,r=e.queue.length;++n<r;)e.queue[n].callRejected(t);return e}},{67:67,68:68,69:69}],61:[function(e,t,n){t.exports=n=e(62),n.resolve=e(66),n.reject=e(65),n.all=e(59),n.race=e(64)},{59:59,62:62,64:64,65:65,66:66}],62:[function(e,t,n){"use strict";function r(e){if(!(this instanceof r))return new r(e);if("function"!=typeof e)throw new TypeError("resolver must be a function");this.state=a.PENDING,this.queue=[],this.outcome=void 0,e!==i&&s.safely(this,e)}var o=e(70),i=e(58),s=e(67),a=e(68),c=e(63);t.exports=r,r.prototype["catch"]=function(e){return this.then(null,e)},r.prototype.then=function(e,t){if("function"!=typeof e&&this.state===a.FULFILLED||"function"!=typeof t&&this.state===a.REJECTED)return this;var n=new r(i);if(this.state!==a.PENDING){var s=this.state===a.FULFILLED?e:t;o(n,s,this.outcome)}else this.queue.push(new c(n,e,t));return n}},{58:58,63:63,67:67,68:68,70:70}],63:[function(e,t,n){"use strict";function r(e,t,n){this.promise=e,"function"==typeof t&&(this.onFulfilled=t,this.callFulfilled=this.otherCallFulfilled),"function"==typeof n&&(this.onRejected=n,this.callRejected=this.otherCallRejected)}var o=e(60),i=e(70);t.exports=r,r.prototype.callFulfilled=function(e){o.resolve(this.promise,e)},r.prototype.otherCallFulfilled=function(e){i(this.promise,this.onFulfilled,e)},r.prototype.callRejected=function(e){o.reject(this.promise,e)},r.prototype.otherCallRejected=function(e){i(this.promise,this.onRejected,e)}},{60:60,70:70}],64:[function(e,t,n){"use strict";function r(e){function t(e){s(e).then(function(e){r||(r=!0,c.resolve(f,e))},function(e){r||(r=!0,c.reject(f,e))})}if("[object Array]"!==Object.prototype.toString.call(e))return i(new TypeError("must be an array"));var n=e.length,r=!1;if(!n)return s([]);for(var u=-1,f=new o(a);++u<n;)t(e[u]);return f}var o=e(62),i=e(65),s=e(66),a=e(58),c=e(60);t.exports=r},{58:58,60:60,62:62,65:65,66:66}],65:[function(e,t,n){"use strict";function r(e){var t=new o(i);return s.reject(t,e)}var o=e(62),i=e(58),s=e(60);t.exports=r},{58:58,60:60,62:62}],66:[function(e,t,n){"use strict";function r(e){if(e)return e instanceof o?e:s.resolve(new o(i),e);var t=typeof e;switch(t){case"boolean":return a;case"undefined":return u;case"object":return c;case"number":return f;case"string":return l}}var o=e(62),i=e(58),s=e(60);t.exports=r;var a=s.resolve(new o(i),!1),c=s.resolve(new o(i),null),u=s.resolve(new o(i),void 0),f=s.resolve(new o(i),0),l=s.resolve(new o(i),"")},{58:58,60:60,62:62}],67:[function(e,t,n){"use strict";function r(e,t){function n(t){a||(a=!0,o.reject(e,t))}function r(t){a||(a=!0,o.resolve(e,t))}function s(){t(r,n)}var a=!1,c=i(s);"error"===c.status&&n(c.value)}var o=e(60),i=e(69);n.safely=r},{60:60,69:69}],68:[function(e,t,n){n.REJECTED=["REJECTED"],n.FULFILLED=["FULFILLED"],n.PENDING=["PENDING"]},{}],69:[function(e,t,n){"use strict";function r(e,t){var n={};try{n.value=e(t),n.status="success"}catch(r){n.status="error",n.value=r}return n}t.exports=r},{}],70:[function(e,t,n){"use strict";function r(e,t,n){o(function(){var r;try{r=t(n)}catch(o){return i.reject(e,o)}r===e?i.reject(e,new TypeError("Cannot resolve promise with itself")):i.resolve(e,r)})}var o=e(71),i=e(60);t.exports=r},{60:60,71:71}],71:[function(e,t,n){"use strict";function r(){i=!0;for(var e,t,n=c.length;n;){for(t=c,c=[],e=-1;++e<n;)t[e]();n=c.length}i=!1}function o(e){1!==c.push(e)||i||s()}for(var i,s,a=[e(51),e(73),e(72),e(74),e(75)],c=[],u=-1,f=a.length;++u<f;)if(a[u]&&a[u].test&&a[u].test()){s=a[u].install(r);break}t.exports=o},{51:51,72:72,73:73,74:74,75:75}],72:[function(e,t,n){(function(e){"use strict";n.test=function(){return e.setImmediate?!1:"undefined"!=typeof e.MessageChannel},n.install=function(t){var n=new e.MessageChannel;return n.port1.onmessage=t,function(){n.port2.postMessage(0)}}}).call(this,"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}],73:[function(e,t,n){(function(e){"use strict";var t=e.MutationObserver||e.WebKitMutationObserver;n.test=function(){return t},n.install=function(n){var r=0,o=new t(n),i=e.document.createTextNode("");return o.observe(i,{characterData:!0}),function(){i.data=r=++r%2}}}).call(this,"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}],74:[function(e,t,n){(function(e){"use strict";n.test=function(){return"document"in e&&"onreadystatechange"in e.document.createElement("script")},n.install=function(t){return function(){var n=e.document.createElement("script");return n.onreadystatechange=function(){t(),n.onreadystatechange=null,n.parentNode.removeChild(n),n=null},e.document.documentElement.appendChild(n),t}}}).call(this,"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}],75:[function(e,t,n){"use strict";n.test=function(){return!0},n.install=function(e){return function(){setTimeout(e,0)}}},{}],76:[function(e,t,n){"use strict";function r(e){if(null!==e)switch(typeof e){case"boolean":return e?1:0;case"number":return f(e);case"string":return e.replace(/\u0002/g,"").replace(/\u0001/g,"").replace(/\u0000/g,"");case"object":var t=Array.isArray(e),r=t?e:Object.keys(e),o=-1,i=r.length,s="";if(t)for(;++o<i;)s+=n.toIndexableString(r[o]);else for(;++o<i;){var a=r[o];s+=n.toIndexableString(a)+n.toIndexableString(e[a])}return s}return""}function o(e,t){var n,r=t,o="1"===e[t];if(o)n=0,t++;else{var i="0"===e[t];t++;var s="",a=e.substring(t,t+d),c=parseInt(a,10)+l;for(i&&(c=-c),t+=d;;){var u=e[t];if("\x00"===u)break;s+=u,t++}s=s.split("."),n=1===s.length?parseInt(s,10):parseFloat(s[0]+"."+s[1]),i&&(n-=10),0!==c&&(n=parseFloat(n+"e"+c))}return{num:n,length:t-r}}function i(e,t){var n=e.pop();if(t.length){var r=t[t.length-1];n===r.element&&(t.pop(),r=t[t.length-1]);var o=r.element,i=r.index;if(Array.isArray(o))o.push(n);else if(i===e.length-2){var s=e.pop();o[s]=n}else e.push(n)}}function s(e,t){for(var r=Math.min(e.length,t.length),o=0;r>o;o++){var i=n.collate(e[o],t[o]);if(0!==i)return i}return e.length===t.length?0:e.length>t.length?1:-1}function a(e,t){return e===t?0:e>t?1:-1}function c(e,t){for(var r=Object.keys(e),o=Object.keys(t),i=Math.min(r.length,o.length),s=0;i>s;s++){var a=n.collate(r[s],o[s]);if(0!==a)return a;if(a=n.collate(e[r[s]],t[o[s]]),0!==a)return a}return r.length===o.length?0:r.length>o.length?1:-1}function u(e){var t=["boolean","number","string","object"],n=t.indexOf(typeof e);return~n?null===e?1:Array.isArray(e)?5:3>n?n+2:n+3:Array.isArray(e)?5:void 0}function f(e){if(0===e)return"1";var t=e.toExponential().split(/e\+?/),n=parseInt(t[1],10),r=0>e,o=r?"0":"2",i=(r?-n:n)-l,s=h.padLeft(i.toString(),"0",d);o+=p+s;var a=Math.abs(parseFloat(t[0]));r&&(a=10-a);var c=a.toFixed(20);return c=c.replace(/\.?0+$/,""),o+=p+c}var l=-324,d=3,p="",h=e(77);n.collate=function(e,t){if(e===t)return 0;e=n.normalizeKey(e),t=n.normalizeKey(t);var r=u(e),o=u(t);if(r-o!==0)return r-o;if(null===e)return 0;switch(typeof e){case"number":return e-t;case"boolean":return e===t?0:t>e?-1:1;case"string":return a(e,t)}return Array.isArray(e)?s(e,t):c(e,t)},n.normalizeKey=function(e){switch(typeof e){case"undefined":return null;case"number":return e===1/0||e===-(1/0)||isNaN(e)?null:e;case"object":var t=e;if(Array.isArray(e)){var r=e.length;e=new Array(r);for(var o=0;r>o;o++)e[o]=n.normalizeKey(t[o])}else{if(e instanceof Date)return e.toJSON();if(null!==e){e={};for(var i in t)if(t.hasOwnProperty(i)){var s=t[i];"undefined"!=typeof s&&(e[i]=n.normalizeKey(s))}}}}return e},n.toIndexableString=function(e){var t="\x00";return e=n.normalizeKey(e),u(e)+p+r(e)+t},n.parseIndexableString=function(e){for(var t=[],n=[],r=0;;){var s=e[r++];if("\x00"!==s)switch(s){case"1":t.push(null);break;case"2":t.push("1"===e[r]),r++;break;case"3":var a=o(e,r);t.push(a.num),r+=a.length;break;case"4":for(var c="";;){var u=e[r];if("\x00"===u)break;c+=u,r++}c=c.replace(/\u0001\u0001/g,"\x00").replace(/\u0001\u0002/g,"").replace(/\u0002\u0002/g,""),t.push(c);break;case"5":var f={element:[],index:t.length};t.push(f.element),n.push(f);break;case"6":var l={element:{},index:t.length};t.push(l.element),n.push(l);break;default:throw new Error("bad collationIndex or unexpectedly reached end of input: "+s)}else{if(1===t.length)return t.pop();i(t,n)}}}},{77:77}],77:[function(e,t,n){"use strict";function r(e,t,n){for(var r="",o=n-e.length;r.length<o;)r+=t;return r}n.padLeft=function(e,t,n){var o=r(e,t,n);return o+e},n.padRight=function(e,t,n){var o=r(e,t,n);return e+o},n.stringLexCompare=function(e,t){var n,r=e.length,o=t.length;for(n=0;r>n;n++){if(n===o)return 1;var i=e.charAt(n),s=t.charAt(n);if(i!==s)return s>i?-1:1}return o>r?-1:0},n.intToDecimalForm=function(e){var t=0>e,n="";do{var r=t?-Math.ceil(e%10):Math.floor(e%10);n=r+n,e=t?Math.ceil(e/10):Math.floor(e/10)}while(e);return t&&"0"!==n&&(n="-"+n),n}},{}],78:[function(e,t,n){"use strict";function r(){this.store={}}function o(e){if(this.store=new r,e&&Array.isArray(e))for(var t=0,n=e.length;n>t;t++)this.add(e[t])}n.Map=r,n.Set=o,r.prototype.mangle=function(e){if("string"!=typeof e)throw new TypeError("key must be a string but Got "+e);return"$"+e},r.prototype.unmangle=function(e){return e.substring(1)},r.prototype.get=function(e){var t=this.mangle(e);return t in this.store?this.store[t]:void 0},r.prototype.set=function(e,t){var n=this.mangle(e);return this.store[n]=t,!0},r.prototype.has=function(e){var t=this.mangle(e);return t in this.store},r.prototype["delete"]=function(e){var t=this.mangle(e);return t in this.store?(delete this.store[t],!0):!1},r.prototype.forEach=function(e){var t=this,n=Object.keys(t.store);n.forEach(function(n){var r=t.store[n];n=t.unmangle(n),e(r,n)})},o.prototype.add=function(e){return this.store.set(e,!0)},o.prototype.has=function(e){return this.store.has(e)},o.prototype["delete"]=function(e){return this.store["delete"](e)}},{}],79:[function(e,t,n){"use strict";function r(e){return null===e?String(e):"object"==typeof e||"function"==typeof e?u[p.call(e)]||"object":typeof e}function o(e){return null!==e&&e===e.window}function i(e){if(!e||"object"!==r(e)||e.nodeType||o(e))return!1;try{if(e.constructor&&!h.call(e,"constructor")&&!h.call(e.constructor.prototype,"isPrototypeOf"))return!1}catch(t){return!1}var n;for(n in e);return void 0===n||h.call(e,n)}function s(e){return"function"===r(e)}function a(){for(var e=[],t=-1,n=arguments.length,r=new Array(n);++t<n;)r[t]=arguments[t];var o={};e.push({args:r,result:{container:o,key:"key"}});for(var i;i=e.pop();)c(e,i.args,i.result);return o.key}function c(e,t,n){var r,o,a,c,u,f,l,d=t[0]||{},p=1,h=t.length,m=!1,_=/\d+/;for("boolean"==typeof d&&(m=d,d=t[1]||{},p=2),"object"==typeof d||s(d)||(d={}),h===p&&(d=this,--p);h>p;p++)if(null!=(r=t[p])){l=v(r);for(o in r)if(!(o in Object.prototype)){if(l&&!_.test(o))continue;if(a=d[o],c=r[o],d===c)continue;m&&c&&(i(c)||(u=v(c)))?(u?(u=!1,f=a&&v(a)?a:[]):f=a&&i(a)?a:{},e.push({args:[m,f,c],result:{container:d,key:o}})):void 0!==c&&(v(r)&&s(c)||(d[o]=c))}}n.container[n.key]=d}for(var u={},f=["Boolean","Number","String","Function","Array","Date","RegExp","Object","Error"],l=0;l<f.length;l++){var d=f[l];u["[object "+d+"]"]=d.toLowerCase()}var p=u.toString,h=u.hasOwnProperty,v=Array.isArray||function(e){return"array"===r(e)};t.exports=a;
},{}],80:[function(e,t,n){"use strict";var r=e(84),o=e(85),i=o.Promise;t.exports=function(e){var t=e.db,n=e.viewName,s=e.map,a=e.reduce,c=e.temporary,u=s.toString()+(a&&a.toString())+"undefined";if(!c&&t._cachedViews){var f=t._cachedViews[u];if(f)return i.resolve(f)}return t.info().then(function(e){function i(e){e.views=e.views||{};var t=n;-1===t.indexOf("/")&&(t=n+"/"+n);var r=e.views[t]=e.views[t]||{};if(!r[f])return r[f]=!0,e}var f=e.db_name+"-mrview-"+(c?"temp":o.MD5(u));return r(t,"_local/mrviews",i).then(function(){return t.registerDependentDatabase(f).then(function(e){var n=e.db;n.auto_compaction=!0;var r={name:f,db:n,sourceDB:t,adapter:t.adapter,mapFun:s,reduceFun:a};return r.db.get("_local/lastSeq")["catch"](function(e){if(404!==e.status)throw e}).then(function(e){return r.seq=e?e.seq:0,c||(t._cachedViews=t._cachedViews||{},t._cachedViews[u]=r,r.db.on("destroyed",function(){delete t._cachedViews[u]})),r})})})})}},{84:84,85:85}],81:[function(_dereq_,module,exports){"use strict";module.exports=function(func,emit,sum,log,isArray,toJSON){return eval("'use strict'; ("+func.replace(/;\s*$/,"")+");")}},{}],82:[function(e,t,n){(function(t){"use strict";function r(e){return-1===e.indexOf("/")?[e,e]:e.split("/")}function o(e){return 1===e.length&&/^1-/.test(e[0].rev)}function i(e,t){try{e.emit("error",t)}catch(n){console.error("The user's map/reduce function threw an uncaught error.\nYou can debug this error by doing:\nmyDatabase.on('error', function (err) { debugger; });\nPlease double-check your map/reduce function."),console.error(t)}}function s(e,t,n){try{return{output:t.apply(null,n)}}catch(r){return i(e,r),{error:r}}}function a(e,t){var n=I(e.key,t.key);return 0!==n?n:I(e.value,t.value)}function c(e,t,n){return n=n||0,"number"==typeof t?e.slice(n,t+n):n>0?e.slice(n):e}function u(e){var t=e.value,n=t&&"object"==typeof t&&t._id||e.id;return n}function f(e){var t="builtin "+e+" function requires map values to be numbers or number arrays";return new q(t)}function l(e){for(var t=0,n=0,r=e.length;r>n;n++){var o=e[n];if("number"!=typeof o){if(!Array.isArray(o))throw f("_sum");t="number"==typeof t?[t]:t;for(var i=0,s=o.length;s>i;i++){var a=o[i];if("number"!=typeof a)throw f("_sum");"undefined"==typeof t[i]?t.push(a):t[i]+=a}}else"number"==typeof t?t+=o:t[0]+=o}return t}function d(e,t,n,r){var o=t[e];"undefined"!=typeof o&&(r&&(o=encodeURIComponent(JSON.stringify(o))),n.push(e+"="+o))}function p(e,t){var n=e.descending?"endkey":"startkey",r=e.descending?"startkey":"endkey";if("undefined"!=typeof e[n]&&"undefined"!=typeof e[r]&&I(e[n],e[r])>0)throw new A("No rows can match your key range, reverse your start_key and end_key or set {descending : true}");if(t.reduce&&e.reduce!==!1){if(e.include_docs)throw new A("{include_docs:true} is invalid for reduce");if(e.keys&&e.keys.length>1&&!e.group&&!e.group_level)throw new A("Multi-key fetches for reduce views must use {group: true}")}if(e.group_level){if("number"!=typeof e.group_level)throw new A('Invalid value for integer: "'+e.group_level+'"');if(e.group_level<0)throw new A('Invalid value for positive integer: "'+e.group_level+'"')}}function h(e,t,n){var o,i=[],s="GET";if(d("reduce",n,i),d("include_docs",n,i),d("attachments",n,i),d("limit",n,i),d("descending",n,i),d("group",n,i),d("group_level",n,i),d("skip",n,i),d("stale",n,i),d("conflicts",n,i),d("startkey",n,i,!0),d("endkey",n,i,!0),d("inclusive_end",n,i),d("key",n,i,!0),i=i.join("&"),i=""===i?"":"?"+i,"undefined"!=typeof n.keys){var a=2e3,c="keys="+encodeURIComponent(JSON.stringify(n.keys));c.length+i.length+1<=a?i+=("?"===i[0]?"&":"?")+c:(s="POST","string"==typeof t?o=JSON.stringify({keys:n.keys}):t.keys=n.keys)}if("string"==typeof t){var u=r(t);return e.request({method:s,url:"_design/"+u[0]+"/_view/"+u[1]+i,body:o})}return o=o||{},Object.keys(t).forEach(function(e){Array.isArray(t[e])?o[e]=t[e]:o[e]=t[e].toString()}),e.request({method:"POST",url:"_temp_view"+i,body:o})}function v(e){return function(t){if(404===t.status)return e;throw t}}function m(e,t,n){function r(){return o(l)?M.resolve(c):t.db.get(a)["catch"](v(c))}function i(e){return e.keys.length?t.db.allDocs({keys:e.keys,include_docs:!0}):M.resolve({rows:[]})}function s(e,t){for(var n=[],r={},o=0,i=t.rows.length;i>o;o++){var s=t.rows[o],a=s.doc;if(a&&(n.push(a),r[a._id]=!0,a._deleted=!f[a._id],!a._deleted)){var c=f[a._id];"value"in c&&(a.value=c.value)}}var u=Object.keys(f);return u.forEach(function(e){if(!r[e]){var t={_id:e},o=f[e];"value"in o&&(t.value=o.value),n.push(t)}}),e.keys=F.uniq(u.concat(e.keys)),n.push(e),n}var a="_local/doc_"+e,c={_id:a,keys:[]},u=n[e],f=u.indexableKeysToKeyValues,l=u.changes;return r().then(function(e){return i(e).then(function(t){return s(e,t)})})}function _(e,t,n){var r="_local/lastSeq";return e.db.get(r)["catch"](v({_id:r,seq:0})).then(function(r){var o=Object.keys(t);return M.all(o.map(function(n){return m(n,e,t)})).then(function(t){var o=F.flatten(t);return r.seq=n,o.push(r),e.db.bulkDocs({docs:o})})})}function g(e){var t="string"==typeof e?e:e.name,n=P[t];return n||(n=P[t]=new D),n}function y(e){return F.sequentialize(g(e),function(){return b(e)})()}function b(e){function t(e,t){var n={id:o._id,key:N(e)};"undefined"!=typeof t&&null!==t&&(n.value=N(t)),r.push(n)}function n(t,n){return function(){return _(e,t,n)}}var r,o,i;if("function"==typeof e.mapFun&&2===e.mapFun.length){var c=e.mapFun;i=function(e){return c(e,t)}}else i=B(e.mapFun.toString(),t,l,R,Array.isArray,JSON.parse);var u=e.seq||0,f=new D;return new M(function(t,c){function l(){f.finish().then(function(){e.seq=u,t()})}function d(){function t(e){c(e)}e.sourceDB.changes({conflicts:!0,include_docs:!0,style:"all_docs",since:u,limit:J}).on("complete",function(t){var c=t.results;if(!c.length)return l();for(var p={},h=0,v=c.length;v>h;h++){var m=c[h];if("_"!==m.doc._id[0]){r=[],o=m.doc,o._deleted||s(e.sourceDB,i,[o]),r.sort(a);for(var _,g={},y=0,b=r.length;b>y;y++){var E=r[y],w=[E.key,E.id];0===I(E.key,_)&&w.push(y);var S=L(w);g[S]=E,_=E.key}p[m.doc._id]={indexableKeysToKeyValues:g,changes:m.changes}}u=m.seq}return f.add(n(p,u)),c.length<J?l():d()}).on("error",t)}d()})}function E(e,t,n){0===n.group_level&&delete n.group_level;var r,o=n.group||n.group_level;r=H[e.reduceFun]?H[e.reduceFun]:B(e.reduceFun.toString(),null,l,R,Array.isArray,JSON.parse);var i=[],a=n.group_level;t.forEach(function(e){var t=i[i.length-1],n=o?e.key:null;return o&&Array.isArray(n)&&"number"==typeof a&&(n=n.length>a?n.slice(0,a):n),t&&0===I(t.key[0][0],n)?(t.key.push([n,e.id]),void t.value.push(e.value)):void i.push({key:[[n,e.id]],value:[e.value]})});for(var u=0,f=i.length;f>u;u++){var d=i[u],p=s(e.sourceDB,r,[d.key,d.value,!1]);if(p.error&&p.error instanceof q)throw p.error;d.value=p.error?null:p.output,d.key=d.key[0][0]}return{rows:c(i,n.limit,n.skip)}}function w(e,t){return F.sequentialize(g(e),function(){return S(e,t)})()}function S(e,t){function n(t){return t.include_docs=!0,e.db.allDocs(t).then(function(e){return o=e.total_rows,e.rows.map(function(e){if("value"in e.doc&&"object"==typeof e.doc.value&&null!==e.doc.value){var t=Object.keys(e.doc.value).sort(),n=["id","key","value"];if(!(n>t||t>n))return e.doc.value}var r=C.parseIndexableString(e.doc._id);return{key:r[0],id:r[1],value:"value"in e.doc?e.doc.value:null}})})}function r(n){var r;if(r=i?E(e,n,t):{total_rows:o,offset:s,rows:n},t.include_docs){var a=F.uniq(n.map(u));return e.sourceDB.allDocs({keys:a,include_docs:!0,conflicts:t.conflicts,attachments:t.attachments}).then(function(e){var t={};return e.rows.forEach(function(e){e.doc&&(t["$"+e.id]=e.doc)}),n.forEach(function(e){var n=u(e),r=t["$"+n];r&&(e.doc=r)}),r})}return r}var o,i=e.reduceFun&&t.reduce!==!1,s=t.skip||0;"undefined"==typeof t.keys||t.keys.length||(t.limit=0,delete t.keys);var a=function(e){return e.reduce(function(e,t){return e.concat(t)})};if("undefined"!=typeof t.keys){var c=t.keys,f=c.map(function(e){var t={startkey:L([e]),endkey:L([e,{}])};return n(t)});return M.all(f).then(a).then(r)}var l={descending:t.descending};if("undefined"!=typeof t.startkey&&(l.startkey=L(t.descending?[t.startkey,{}]:[t.startkey])),"undefined"!=typeof t.endkey){var d=t.inclusive_end!==!1;t.descending&&(d=!d),l.endkey=L(d?[t.endkey,{}]:[t.endkey])}if("undefined"!=typeof t.key){var p=L([t.key]),h=L([t.key,{}]);l.descending?(l.endkey=p,l.startkey=h):(l.startkey=p,l.endkey=h)}return i||("number"==typeof t.limit&&(l.limit=t.limit),l.skip=s),n(l).then(r)}function T(e){return e.request({method:"POST",url:"_view_cleanup"})}function x(e){return e.get("_local/mrviews").then(function(t){var n={};Object.keys(t.views).forEach(function(e){var t=r(e),o="_design/"+t[0],i=t[1];n[o]=n[o]||{},n[o][i]=!0});var o={keys:Object.keys(n),include_docs:!0};return e.allDocs(o).then(function(r){var o={};r.rows.forEach(function(e){var r=e.key.substring(8);Object.keys(n[e.key]).forEach(function(n){var i=r+"/"+n;t.views[i]||(i=n);var s=Object.keys(t.views[i]),a=e.doc&&e.doc.views&&e.doc.views[n];s.forEach(function(e){o[e]=o[e]||a})})});var i=Object.keys(o).filter(function(e){return!o[e]}),s=i.map(function(t){return F.sequentialize(g(t),function(){return new e.constructor(t,e.__opts).destroy()})()});return M.all(s).then(function(){return{ok:!0}})})},v({ok:!0}))}function O(e,n,o){if("http"===e.type())return h(e,n,o);if("string"!=typeof n){p(o,n);var i={db:e,viewName:"temp_view/temp_view",map:n.map,reduce:n.reduce,temporary:!0};return U.add(function(){return j(i).then(function(e){function t(){return e.db.destroy()}return F.fin(y(e).then(function(){return w(e,o)}),t)})}),U.finish()}var s=n,a=r(s),c=a[0],u=a[1];return e.get("_design/"+c).then(function(n){var r=n.views&&n.views[u];if(!r||"string"!=typeof r.map)throw new k("ddoc "+c+" has no view named "+u);p(o,r);var i={db:e,viewName:s,map:r.map,reduce:r.reduce};return j(i).then(function(e){return"ok"===o.stale||"update_after"===o.stale?("update_after"===o.stale&&t.nextTick(function(){y(e)}),w(e,o)):y(e).then(function(){return w(e,o)})})})}function A(e){this.status=400,this.name="query_parse_error",this.message=e,this.error=!0;try{Error.captureStackTrace(this,A)}catch(t){}}function k(e){this.status=404,this.name="not_found",this.message=e,this.error=!0;try{Error.captureStackTrace(this,k)}catch(t){}}function q(e){this.status=500,this.name="invalid_value",this.message=e,this.error=!0;try{Error.captureStackTrace(this,q)}catch(t){}}var R,C=e(76),D=e(83),I=C.collate,L=C.toIndexableString,N=C.normalizeKey,j=e(80),B=e(81);R="undefined"!=typeof console&&"function"==typeof console.log?Function.prototype.bind.call(console.log,console):function(){};var F=e(85),M=F.Promise,P={},U=new D,J=50,H={_sum:function(e,t){return l(t)},_count:function(e,t){return t.length},_stats:function(e,t){function n(e){for(var t=0,n=0,r=e.length;r>n;n++){var o=e[n];t+=o*o}return t}return{sum:l(t),min:Math.min.apply(null,t),max:Math.max.apply(null,t),count:t.length,sumsqr:n(t)}}};n.viewCleanup=F.callbackify(function(){var e=this;return"http"===e.type()?T(e):x(e)}),n.query=function(e,t,n){"function"==typeof t&&(n=t,t={}),t=F.extend(!0,{},t),"function"==typeof e&&(e={map:e});var r=this,o=M.resolve().then(function(){return O(r,e,t)});return F.promisedCallback(o,n),o},F.inherits(A,Error),F.inherits(k,Error),F.inherits(q,Error)}).call(this,e(53))},{53:53,76:76,80:80,81:81,83:83,85:85}],83:[function(e,t,n){"use strict";function r(){this.promise=new o(function(e){e()})}var o=e(85).Promise;r.prototype.add=function(e){return this.promise=this.promise["catch"](function(){}).then(function(){return e()}),this.promise},r.prototype.finish=function(){return this.promise},t.exports=r},{85:85}],84:[function(e,t,n){"use strict";var r=e(86).upsert;t.exports=function(e,t,n){return r.apply(e,[t,n])}},{86:86}],85:[function(e,t,n){(function(t,r){"use strict";"function"==typeof r.Promise?n.Promise=r.Promise:n.Promise=e(61),n.inherits=e(57),n.extend=e(79);var o=e(50);n.promisedCallback=function(e,n){return n&&e.then(function(e){t.nextTick(function(){n(null,e)})},function(e){t.nextTick(function(){n(e)})}),e},n.callbackify=function(e){return o(function(t){var r=t.pop(),o=e.apply(this,t);return"function"==typeof r&&n.promisedCallback(o,r),o})},n.fin=function(e,t){return e.then(function(e){var n=t();return"function"==typeof n.then?n.then(function(){return e}):e},function(e){var n=t();if("function"==typeof n.then)return n.then(function(){throw e});throw e})},n.sequentialize=function(e,t){return function(){var n=arguments,r=this;return e.add(function(){return t.apply(r,n)})}},n.flatten=function(e){for(var t=[],n=0,r=e.length;r>n;n++)t=t.concat(e[n]);return t},n.uniq=function(e){for(var t={},n=0,r=e.length;r>n;n++)t["$"+e[n]]=!0;var o=Object.keys(t),i=new Array(o.length);for(n=0,r=o.length;r>n;n++)i[n]=o[n].substring(1);return i};var i=e(51),s=e(87);n.MD5=function(e){return t.browser?s.hash(e):i.createHash("md5").update(e).digest("hex")}}).call(this,e(53),"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{50:50,51:51,53:53,57:57,61:61,79:79,87:87}],86:[function(e,t,n){(function(t){"use strict";function r(e,t,n){return new i(function(r,i){return"string"!=typeof t?i(new Error("doc id is required")):void e.get(t,function(s,a){if(s){if(404!==s.status)return i(s);a={}}var c=a._rev,u=n(a);return u?(u._id=t,u._rev=c,void r(o(e,u,n))):r({updated:!1,rev:c})})})}function o(e,t,n){return e.put(t).then(function(e){return{updated:!0,rev:e.rev}},function(o){if(409!==o.status)throw o;return r(e,t._id,n)})}var i;i="undefined"!=typeof window&&window.PouchDB?window.PouchDB.utils.Promise:"function"==typeof t.Promise?t.Promise:e(61),n.upsert=function(e,t,n){var o=this,i=r(o,e,t);return"function"!=typeof n?i:void i.then(function(e){n(null,e)},n)},n.putIfNotExists=function(e,t,n){var o=this;"string"!=typeof e&&(n=t,t=e,e=t._id);var i=function(e){return e._rev?!1:t},s=r(o,e,i);return"function"!=typeof n?s:void s.then(function(e){n(null,e)},n)},"undefined"!=typeof window&&window.PouchDB&&window.PouchDB.plugin(n)}).call(this,"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{61:61}],87:[function(e,t,n){!function(e){if("object"==typeof n)t.exports=e();else if("function"==typeof define&&define.amd)define(e);else{var r;try{r=window}catch(o){r=self}r.SparkMD5=e()}}(function(e){"use strict";var t=function(e,t){return e+t&4294967295},n=function(e,n,r,o,i,s){return n=t(t(n,e),t(o,s)),t(n<<i|n>>>32-i,r)},r=function(e,t,r,o,i,s,a){return n(t&r|~t&o,e,t,i,s,a)},o=function(e,t,r,o,i,s,a){return n(t&o|r&~o,e,t,i,s,a)},i=function(e,t,r,o,i,s,a){return n(t^r^o,e,t,i,s,a)},s=function(e,t,r,o,i,s,a){return n(r^(t|~o),e,t,i,s,a)},a=function(e,n){var a=e[0],c=e[1],u=e[2],f=e[3];a=r(a,c,u,f,n[0],7,-680876936),f=r(f,a,c,u,n[1],12,-389564586),u=r(u,f,a,c,n[2],17,606105819),c=r(c,u,f,a,n[3],22,-1044525330),a=r(a,c,u,f,n[4],7,-176418897),f=r(f,a,c,u,n[5],12,1200080426),u=r(u,f,a,c,n[6],17,-1473231341),c=r(c,u,f,a,n[7],22,-45705983),a=r(a,c,u,f,n[8],7,1770035416),f=r(f,a,c,u,n[9],12,-1958414417),u=r(u,f,a,c,n[10],17,-42063),c=r(c,u,f,a,n[11],22,-1990404162),a=r(a,c,u,f,n[12],7,1804603682),f=r(f,a,c,u,n[13],12,-40341101),u=r(u,f,a,c,n[14],17,-1502002290),c=r(c,u,f,a,n[15],22,1236535329),a=o(a,c,u,f,n[1],5,-165796510),f=o(f,a,c,u,n[6],9,-1069501632),u=o(u,f,a,c,n[11],14,643717713),c=o(c,u,f,a,n[0],20,-373897302),a=o(a,c,u,f,n[5],5,-701558691),f=o(f,a,c,u,n[10],9,38016083),u=o(u,f,a,c,n[15],14,-660478335),c=o(c,u,f,a,n[4],20,-405537848),a=o(a,c,u,f,n[9],5,568446438),f=o(f,a,c,u,n[14],9,-1019803690),u=o(u,f,a,c,n[3],14,-187363961),c=o(c,u,f,a,n[8],20,1163531501),a=o(a,c,u,f,n[13],5,-1444681467),f=o(f,a,c,u,n[2],9,-51403784),u=o(u,f,a,c,n[7],14,1735328473),c=o(c,u,f,a,n[12],20,-1926607734),a=i(a,c,u,f,n[5],4,-378558),f=i(f,a,c,u,n[8],11,-2022574463),u=i(u,f,a,c,n[11],16,1839030562),c=i(c,u,f,a,n[14],23,-35309556),a=i(a,c,u,f,n[1],4,-1530992060),f=i(f,a,c,u,n[4],11,1272893353),u=i(u,f,a,c,n[7],16,-155497632),c=i(c,u,f,a,n[10],23,-1094730640),a=i(a,c,u,f,n[13],4,681279174),f=i(f,a,c,u,n[0],11,-358537222),u=i(u,f,a,c,n[3],16,-722521979),c=i(c,u,f,a,n[6],23,76029189),a=i(a,c,u,f,n[9],4,-640364487),f=i(f,a,c,u,n[12],11,-421815835),u=i(u,f,a,c,n[15],16,530742520),c=i(c,u,f,a,n[2],23,-995338651),a=s(a,c,u,f,n[0],6,-198630844),f=s(f,a,c,u,n[7],10,1126891415),u=s(u,f,a,c,n[14],15,-1416354905),c=s(c,u,f,a,n[5],21,-57434055),a=s(a,c,u,f,n[12],6,1700485571),f=s(f,a,c,u,n[3],10,-1894986606),u=s(u,f,a,c,n[10],15,-1051523),c=s(c,u,f,a,n[1],21,-2054922799),a=s(a,c,u,f,n[8],6,1873313359),f=s(f,a,c,u,n[15],10,-30611744),u=s(u,f,a,c,n[6],15,-1560198380),c=s(c,u,f,a,n[13],21,1309151649),a=s(a,c,u,f,n[4],6,-145523070),f=s(f,a,c,u,n[11],10,-1120210379),u=s(u,f,a,c,n[2],15,718787259),c=s(c,u,f,a,n[9],21,-343485551),e[0]=t(a,e[0]),e[1]=t(c,e[1]),e[2]=t(u,e[2]),e[3]=t(f,e[3])},c=function(e){var t,n=[];for(t=0;64>t;t+=4)n[t>>2]=e.charCodeAt(t)+(e.charCodeAt(t+1)<<8)+(e.charCodeAt(t+2)<<16)+(e.charCodeAt(t+3)<<24);return n},u=function(e){var t,n=[];for(t=0;64>t;t+=4)n[t>>2]=e[t]+(e[t+1]<<8)+(e[t+2]<<16)+(e[t+3]<<24);return n},f=function(e){var t,n,r,o,i,s,u=e.length,f=[1732584193,-271733879,-1732584194,271733878];for(t=64;u>=t;t+=64)a(f,c(e.substring(t-64,t)));for(e=e.substring(t-64),n=e.length,r=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],t=0;n>t;t+=1)r[t>>2]|=e.charCodeAt(t)<<(t%4<<3);if(r[t>>2]|=128<<(t%4<<3),t>55)for(a(f,r),t=0;16>t;t+=1)r[t]=0;return o=8*u,o=o.toString(16).match(/(.*?)(.{0,8})$/),i=parseInt(o[2],16),s=parseInt(o[1],16)||0,r[14]=i,r[15]=s,a(f,r),f},l=function(e){var t,n,r,o,i,s,c=e.length,f=[1732584193,-271733879,-1732584194,271733878];for(t=64;c>=t;t+=64)a(f,u(e.subarray(t-64,t)));for(e=c>t-64?e.subarray(t-64):new Uint8Array(0),n=e.length,r=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],t=0;n>t;t+=1)r[t>>2]|=e[t]<<(t%4<<3);if(r[t>>2]|=128<<(t%4<<3),t>55)for(a(f,r),t=0;16>t;t+=1)r[t]=0;return o=8*c,o=o.toString(16).match(/(.*?)(.{0,8})$/),i=parseInt(o[2],16),s=parseInt(o[1],16)||0,r[14]=i,r[15]=s,a(f,r),f},d=["0","1","2","3","4","5","6","7","8","9","a","b","c","d","e","f"],p=function(e){var t,n="";for(t=0;4>t;t+=1)n+=d[e>>8*t+4&15]+d[e>>8*t&15];return n},h=function(e){var t;for(t=0;t<e.length;t+=1)e[t]=p(e[t]);return e.join("")},v=function(e){return h(f(e))},m=function(){this.reset()};return"5d41402abc4b2a76b9719d911017c592"!==v("hello")&&(t=function(e,t){var n=(65535&e)+(65535&t),r=(e>>16)+(t>>16)+(n>>16);return r<<16|65535&n}),m.prototype.append=function(e){return/[\u0080-\uFFFF]/.test(e)&&(e=unescape(encodeURIComponent(e))),this.appendBinary(e),this},m.prototype.appendBinary=function(e){this._buff+=e,this._length+=e.length;var t,n=this._buff.length;for(t=64;n>=t;t+=64)a(this._state,c(this._buff.substring(t-64,t)));return this._buff=this._buff.substr(t-64),this},m.prototype.end=function(e){var t,n,r=this._buff,o=r.length,i=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];for(t=0;o>t;t+=1)i[t>>2]|=r.charCodeAt(t)<<(t%4<<3);return this._finish(i,o),n=e?this._state:h(this._state),this.reset(),n},m.prototype._finish=function(e,t){var n,r,o,i=t;if(e[i>>2]|=128<<(i%4<<3),i>55)for(a(this._state,e),i=0;16>i;i+=1)e[i]=0;n=8*this._length,n=n.toString(16).match(/(.*?)(.{0,8})$/),r=parseInt(n[2],16),o=parseInt(n[1],16)||0,e[14]=r,e[15]=o,a(this._state,e)},m.prototype.reset=function(){return this._buff="",this._length=0,this._state=[1732584193,-271733879,-1732584194,271733878],this},m.prototype.destroy=function(){delete this._state,delete this._buff,delete this._length},m.hash=function(e,t){/[\u0080-\uFFFF]/.test(e)&&(e=unescape(encodeURIComponent(e)));var n=f(e);return t?n:h(n)},m.hashBinary=function(e,t){var n=f(e);return t?n:h(n)},m.ArrayBuffer=function(){this.reset()},m.ArrayBuffer.prototype.append=function(e){var t,n=this._concatArrayBuffer(this._buff,e),r=n.length;for(this._length+=e.byteLength,t=64;r>=t;t+=64)a(this._state,u(n.subarray(t-64,t)));return this._buff=r>t-64?n.subarray(t-64):new Uint8Array(0),this},m.ArrayBuffer.prototype.end=function(e){var t,n,r=this._buff,o=r.length,i=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];for(t=0;o>t;t+=1)i[t>>2]|=r[t]<<(t%4<<3);return this._finish(i,o),n=e?this._state:h(this._state),this.reset(),n},m.ArrayBuffer.prototype._finish=m.prototype._finish,m.ArrayBuffer.prototype.reset=function(){return this._buff=new Uint8Array(0),this._length=0,this._state=[1732584193,-271733879,-1732584194,271733878],this},m.ArrayBuffer.prototype.destroy=m.prototype.destroy,m.ArrayBuffer.prototype._concatArrayBuffer=function(e,t){var n=e.length,r=new Uint8Array(n+t.byteLength);return r.set(e),r.set(new Uint8Array(t),n),r},m.ArrayBuffer.hash=function(e,t){var n=l(new Uint8Array(e));return t?n:h(n)},m})},{}],88:[function(e,t,n){"use strict";function r(e,t,n){var r=n[n.length-1];e===r.element&&(n.pop(),r=n[n.length-1]);var o=r.element,i=r.index;if(Array.isArray(o))o.push(e);else if(i===t.length-2){var s=t.pop();o[s]=e}else t.push(e)}n.stringify=function(e){var t=[];t.push({obj:e});for(var n,r,o,i,s,a,c,u,f,l,d,p="";n=t.pop();)if(r=n.obj,o=n.prefix||"",i=n.val||"",p+=o,i)p+=i;else if("object"!=typeof r)p+="undefined"==typeof r?null:JSON.stringify(r);else if(null===r)p+="null";else if(Array.isArray(r)){for(t.push({val:"]"}),s=r.length-1;s>=0;s--)a=0===s?"":",",t.push({obj:r[s],prefix:a});t.push({val:"["})}else{c=[];for(u in r)r.hasOwnProperty(u)&&c.push(u);for(t.push({val:"}"}),s=c.length-1;s>=0;s--)f=c[s],l=r[f],d=s>0?",":"",d+=JSON.stringify(f)+":",t.push({obj:l,prefix:d});t.push({val:"{"})}return p},n.parse=function(e){for(var t,n,o,i,s,a,c,u,f,l=[],d=[],p=0;;)if(t=e[p++],"}"!==t&&"]"!==t&&"undefined"!=typeof t)switch(t){case" ":case"	":case"\n":case":":case",":break;case"n":p+=3,r(null,l,d);break;case"t":p+=3,r(!0,l,d);break;case"f":p+=4,r(!1,l,d);break;case"0":case"1":case"2":case"3":case"4":case"5":case"6":case"7":case"8":case"9":case"-":for(n="",p--;;){if(o=e[p++],!/[\d\.\-e\+]/.test(o)){p--;break}n+=o}r(parseFloat(n),l,d);break;case'"':for(i="",s=void 0,a=0;;){if(c=e[p++],'"'===c&&("\\"!==s||a%2!==1))break;i+=c,s=c,"\\"===s?a++:a=0}r(JSON.parse('"'+i+'"'),l,d);break;case"[":u={element:[],index:l.length},l.push(u.element),d.push(u);break;case"{":f={element:{},index:l.length},l.push(f.element),d.push(f);break;default:throw new Error("unexpectedly reached end of input: "+t)}else{if(1===l.length)return l.pop();r(l.pop(),l,d)}}},{}],89:[function(e,t,n){(function(n){"use strict";var r=e(45);t.exports=r,r.ajax=e(15),r.utils=e(48),r.Errors=e(24),r.replicate=e(42).replicate,r.sync=e(46),r.version=e(49);var o=e(2);if(r.adapter("http",o),r.adapter("https",o),r.adapter("idb",e(8),!0),r.adapter("websql",e(12),!0),r.plugin(e(82)),!n.browser){var i=e(51);r.adapter("leveldb",i,!0)}}).call(this,e(53))},{12:12,15:15,2:2,24:24,42:42,45:45,46:46,48:48,49:49,51:51,53:53,8:8,82:82}]},{},[89])(89)});

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}]},{},[26])


//# sourceMappingURL=build.js.map