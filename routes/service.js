const express = require('express');
const { postService, getResult, getResultByGuid, testLogger, getQueueStatus } = require('../controllers/service');
const auth =  require('../middleware/auth');
const { upload } = require('../lib/fileManagement')


const router = express.Router();

router
    .route('/:service')
    .post(upload.single('audio'), auth, postService);

router
    .route('/:service/:payment_hash/get_result')
    .get(auth, getResult);

router
    .route('/:service/:guid/get_result_by_guid')
    .get(auth, getResultByGuid);

router
    .route('/queue/status')
    .get(auth, getQueueStatus);

/*router
    .route('/:service/test')
    .post(upload.single('audio'), auth, testLogger)*/

module.exports = router;