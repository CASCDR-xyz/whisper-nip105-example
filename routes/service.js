const express = require('express');
const { postService, getResult, testLogger } = require('../controllers/service');
const auth =  require('../middleware/auth');
const { upload } = require('../lib/fileManagement')


const router = express.Router();

router
    .route('/:service')
    .post(upload.single('audio'), auth, postService);

router
    .route('/:service/:payment_hash/get_result')
    .get(auth, getResult);

//force push

module.exports = router;