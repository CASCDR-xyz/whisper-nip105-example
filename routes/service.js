const express = require('express');
const { postService, getResult, testLogger, getQueueStatus } = require('../controllers/service');
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
    .route('/queue/status')
    .get(auth, getQueueStatus);

/*router
    .route('/:service/test')
    .post(upload.single('audio'), auth, testLogger)*/

module.exports = router;