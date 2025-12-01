import fetch, { FormData, fileFromSync } from 'node-fetch';
import path from 'path';

async function testOCR() {
    console.log('🧪 Testing OCR Fix...');

    // Use the image provided by the user
    const imagePath = 'C:/Users/uniha/.gemini/antigravity/brain/90805031-2f6b-4b22-a487-1a53b69a92f2/uploaded_image_1764617666253.jpg';

    try {
        const formData = new FormData();
        const file = fileFromSync(imagePath);
        formData.append('image', file);

        console.log('📤 Sending request to http://localhost:5001/api/ocr...');
        const response = await fetch('http://localhost:5001/api/ocr', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const data = await response.json();
            console.log('✅ Success! OCR Result:');
            console.log(JSON.stringify(data, null, 2));
        } else {
            console.error(`❌ Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error('Response:', text);
        }
    } catch (error) {
        console.error('❌ Request failed:', error);
    }
}

testOCR();
