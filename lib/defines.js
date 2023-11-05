
const OFFERING_KIND = 31_402;

const WHSPR_SCHEMA = {
    "type": "object",
    "properties": {
        "audio": {
            "type": "string"
        },
    },
    "required": ["clipDurationSeconds","audioURL"]
}
const WHSPR_RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "text": {
            "type": "string"
        },
    },
    "required": ["text"]
}

const WHSPR_REMOTE_SCHEMA = {
    "type": "object",
    "properties": {
        "remote_url": {
            "type": "string"
        },
    },
    "required": ["clipDurationSeconds","audioURL"]
}


module.exports = { WHSPR_SCHEMA, WHSPR_RESULT_SCHEMA, WHSPR_REMOTE_SCHEMA, OFFERING_KIND };