import dotenv from 'dotenv'

function loadDotenv() {
    dotenv.config();
    console.log(process.env);
}

loadDotenv();
