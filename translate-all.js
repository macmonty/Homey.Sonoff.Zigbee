import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { translate } from '@vitalets/google-translate-api';
import fetch from 'node-fetch';

const languages = ['da', 'de', 'es', 'fr', 'it', 'ko', 'nl', 'no', 'pl', 'ru', 'sv'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const AZURE_KEY = process.env.AZURE_TRANSLATOR_KEY;
const AZURE_REGION = process.env.AZURE_TRANSLATOR_REGION || 'northeurope'; // e.g. 'westeurope'
const AZURE_ENDPOINT = 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0';


/*
async function translateText(text, lang) {
  try {
    await sleep(500);
    const res = await translate(text, { to: lang });
    return res.text;
  } catch (e) {
    console.error(`Translation error to "${lang}":`, e.message);
    return text;
  }
}
*/

async function translateText(text, lang) {
  try {
    const response = await fetch(`${AZURE_ENDPOINT}&to=${lang}`, {
      method: 'POST',
      body: JSON.stringify([{ Text: text }]),
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_KEY,
        'Ocp-Apim-Subscription-Region': AZURE_REGION,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data[0].translations[0].text;
  } catch (e) {
    console.error(`Translation error to "${lang}":`, e.message);
    return text;
  }
}

async function translateJsonObject(obj) {
  if (Array.isArray(obj)) {
    return Promise.all(obj.map(translateJsonObject));
  } else if (typeof obj === 'object' && obj !== null) {
    for (const key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null && obj[key].en) {
        for (const lang of languages) {
            if (!obj[key][lang] || obj[key][lang] === '') { //} || obj[key][lang] === obj[key].en) {
                obj[key][lang] = await translateText(obj[key].en, lang);
            }
        }
      } else {
        await translateJsonObject(obj[key]);
      }
    }
  }
  return obj;
}

async function processJsonFiles() {
  const files = glob.sync('**/*.json', { ignore: 'node_modules/**' });
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    let json;
    try {
      json = JSON.parse(content);
    } catch {
      continue; // skip invalid JSON
    }
    console.log(`Translating JSON: ${file}`);
    const translated = await translateJsonObject(json);
    fs.writeFileSync(file, JSON.stringify(translated, null, 2), 'utf8');
  }
}

async function processTxtFiles() {
  const files = glob.sync('**/*.txt', { ignore: ['node_modules/**', '**/*.[a-z][a-z].txt'] });
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const lang of languages) {
      const translated = await translateText(text, lang);
      const outFile = file.replace(/\.txt$/, `.${lang}.txt`);
      fs.writeFileSync(outFile, translated, 'utf8');
      console.log(`Translated TXT: ${outFile}`);
    }
  }
}

(async () => {
  //await processJsonFiles();
  await processTxtFiles();
  console.log('Translation complete!');
})();