import dotenv from 'dotenv'

function loadDotEnv(): dotenv.DotenvConfigOutput {
    return dotenv.config();
}

loadDotEnv();
