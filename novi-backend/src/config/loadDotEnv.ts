import dotenv from 'dotenv'

function loadDotenv(): dotenv.DotenvConfigOutput {
    return dotenv.config();
}

loadDotenv();
