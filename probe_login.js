const { chromium } = require('playwright');
const fs = require('fs');

async function probe() {
    console.log('Starting browser...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        console.log('Navigating to login page...');
        await page.goto('https://jb.mytracking.com.br/mytracking/pages/public/login.xhtml', { waitUntil: 'networkidle' });
        
        // Wait a bit for Cloudflare
        await page.waitForTimeout(5000);

        console.log('Taking screenshot...');
        await page.screenshot({ path: 'login_probe.png' });

        console.log('Saving HTML...');
        const html = await page.content();
        fs.writeFileSync('login_probe.html', html);

        // Find input fields
        const inputs = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('input')).map(i => ({
                id: i.id,
                name: i.name,
                type: i.type,
                value: i.value
            }));
        });
        console.log('Input fields found:', JSON.stringify(inputs, null, 2));

        const buttons = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('button, input[type="submit"]')).map(b => ({
                id: b.id,
                name: b.name,
                text: b.innerText || b.value
            }));
        });
        console.log('Buttons found:', JSON.stringify(buttons, null, 2));

    } catch (error) {
        console.error('Error during probe:', error);
    } finally {
        await browser.close();
    }
}

probe();
