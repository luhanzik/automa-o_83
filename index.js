const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

chromium.use(stealth);

// --- CONFIGURAÇÃO DE USUÁRIOS (Ordem: Luhan -> Gabriel -> Esther) ---
const USERS = [
    { email: 'luhan.vinicius@transcleber.com.br', pass: 'Luhan123@@' },
    { email: 'gabriel.silva@transcleber.com.br', pass: 'Gabr2312!*' },
    { email: 'maria.esther@transcleber.com.br', pass: 'TheraJob@7' }
];

// --- CONFIGURAÇÃO DE FILIAIS ---
const FILIAIS = [
    { nome: 'FORTALEZA', pasta: 'FOR' },
    { nome: 'IMPERATRIZ', pasta: 'IMP' },
    { nome: 'JUAZEIRO', pasta: 'JUA' },
    { nome: 'SÃO LUÍS', pasta: 'SLZ' },
    { nome: 'SOBRAL', pasta: 'SOB' },
    { nome: 'TERESINA', pasta: 'THE' }
];

// --- FUNÇÕES DE PERSISTÊNCIA DE PROGRESSO ---
const PROGRESS_FILE = 'progress.json';

function getTodayStr() {
    return new Date().toISOString().split('T')[0];
}

function loadProgress() {
    if (fs.existsSync(PROGRESS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
            if (data.date === getTodayStr()) {
                return data.completed || [];
            }
        } catch (e) {
            console.error('Erro ao ler arquivo de progresso:', e.message);
        }
    }
    return [];
}

function saveProgress(filialNome) {
    const completed = loadProgress();
    if (!completed.includes(filialNome)) {
        completed.push(filialNome);
        fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
            date: getTodayStr(),
            completed: completed
        }, null, 2));
    }
}

async function run(userIndex = 0) {
    if (userIndex >= USERS.length) {
        console.log('\n❌ ERRO: Todos os usuários atingiram o limite de hoje e ainda restam filiais.');
        return;
    }

    const completedFiliais = loadProgress();
    const remainingFiliais = FILIAIS.filter(f => !completedFiliais.includes(f.nome));

    if (remainingFiliais.length === 0) {
        console.log('\n✅ Todas as filiais já foram processadas hoje!');
        // Se quiser resetar o arquivo de progresso após o sucesso total:
        // fs.unlinkSync(PROGRESS_FILE); 
        return;
    }

    const currentUser = USERS[userIndex];
    const stateFile = `state_${currentUser.email.split('@')[0]}.json`;
    
    console.log(`\n================================================`);
    console.log(`USUÁRIO ATUAL: ${currentUser.email}`);
    console.log(`PROGRESSO: ${completedFiliais.length}/${FILIAIS.length} filiais concluídas`);
    console.log(`================================================\n`);

    const browser = await chromium.launch({
        headless: process.platform === 'linux', // Headless no Airflow (Linux)
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
    });

    const contextOptions = fs.existsSync(stateFile) ? { storageState: stateFile } : {};
    const context = await browser.newContext({
        ...contextOptions,
        viewport: null,
        acceptDownloads: true
    });

    const page = await context.newPage();
    page.setDefaultTimeout(60000); // Aumentar timeout padrão para 60s

    try {
        console.log('Acessando página de relatórios...');
        await page.goto(process.env.REPORT_URL, { waitUntil: 'networkidle', timeout: 90000 });

        if (page.url().includes('login.xhtml')) {
            console.log('Sessão expirada ou inexistente. Fazendo login...');
            await page.fill('#username', currentUser.email);
            await page.fill('#password', currentUser.pass);
            await page.click('#j_idt9');

            try {
                const errorMsg = page.locator('.ui-messages-error-detail, .ui-growl-item');
                if (await errorMsg.isVisible({ timeout: 10000 })) {
                    const msgText = await errorMsg.innerText();
                    console.log(`⚠️ Erro no login (${currentUser.email}): ${msgText}`);
                    await browser.close();
                    
                    if (msgText.toLowerCase().includes('limite') || msgText.toLowerCase().includes('inválid')) {
                        return run(userIndex + 1); // Tenta próximo usuário
                    }
                    // Se for outro erro, tenta novamente com o mesmo usuário após um delay
                    await new Promise(r => setTimeout(r, 10000));
                    return run(userIndex);
                }
            } catch (e) {}

            try {
                const popupOk = page.locator('#usuarioLogadoOK');
                if (await popupOk.isVisible({ timeout: 5000 })) {
                    await popupOk.click();
                }
            } catch (e) {}

            await page.waitForURL(url => url.toString().includes('private'), { timeout: 60000 });
            await page.goto(process.env.REPORT_URL, { waitUntil: 'networkidle' });
            await context.storageState({ path: stateFile });
        }

        // --- SELEÇÃO DE RELATÓRIO ---
        console.log('Selecionando Relatório: 14 - Tracking 360...');
        await page.locator('div[id="form:grupo"] .ui-selectonemenu-trigger').click({ delay: 500 });
        await page.waitForTimeout(2000);
        await page.locator('.ui-selectonemenu-panel:visible li').filter({ hasText: /^14 -/ }).click({ delay: 300 });
        
        await page.waitForTimeout(4000); // Espera carregar sub-relatórios

        console.log('Selecionando Sub-Relatório: 83 - Entregas...');
        await page.locator('div[id*="relatorio"] .ui-selectonemenu-trigger, .ui-selectonemenu:not(.ui-state-disabled)').last().click({ delay: 500 });
        await page.waitForTimeout(2000);
        await page.locator('.ui-selectonemenu-panel:visible li').filter({ hasText: /^83 -/ }).click({ delay: 300 });
        
        await page.waitForTimeout(5000);

        // --- LOOP PELAS FILIAIS RESTANTES ---
        for (const filial of FILIAIS) {
            if (completedFiliais.includes(filial.nome)) continue;

            let retryCount = 0;
            const maxRetries = 3;
            let success = false;

            while (retryCount < maxRetries && !success) {
                try {
                    console.log(`\n>>> Processando: ${filial.nome} (Tentativa ${retryCount + 1}/${maxRetries})...`);

                    console.log('Abrindo filtros...');
                    await page.click('button[id="form:bt_filtro"]', { delay: 1000 });
                    await page.waitForTimeout(3000);

                    // Configurar Datas
                    const now = new Date();
                    const todayDay = String(now.getDate());
                    await page.locator('input[id$=":0:data__input"]').click();
                    await page.click('.ui-datepicker-calendar:visible a:text-is("1")');
                    await page.waitForTimeout(1000);
                    await page.locator('input[id$=":1:data__input"]').click();
                    await page.click(`.ui-datepicker-calendar:visible a:text-is("${todayDay}")`);
                    await page.waitForTimeout(1500);

                    // Selecionar Filial
                    console.log(`Selecionando CD ${filial.nome}...`);
                    await page.locator('label[id$=":2:mq__label"]').click({ force: true });
                    await page.waitForTimeout(2000);

                    const panel = page.locator('.ui-selectcheckboxmenu-panel:visible');
                    const allCheckbox = panel.locator('.ui-selectcheckboxmenu-header .ui-chkbox-box');
                    
                    await allCheckbox.click();
                    await page.waitForTimeout(800);
                    await allCheckbox.click();
                    await page.waitForTimeout(1000);

                    await panel.locator('li').filter({ hasText: new RegExp(`^${filial.nome}$`, 'i') }).locator('.ui-chkbox-box').click({ force: true });
                    await page.waitForTimeout(1000);
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(1000);

                    console.log('Consultando...');
                    await page.click('.ui-dialog:visible button:has-text("consultar")');

                    // Verificação de Limite de Execução
                    const limitMsg = page.locator('.ui-growl-item:has-text("limite de execução"), .ui-messages:has-text("limite de execução")');
                    if (await limitMsg.isVisible({ timeout: 8000 })) {
                        console.log(`⚠️ LIMITE ATINGIDO em ${filial.nome}. Trocando usuário...`);
                        await browser.close();
                        return run(userIndex + 1); // Próximo usuário, mesma filial (progress.json mantém o estado)
                    }

                    console.log('Aguardando carregamento de dados...');
                    const loading = page.locator('.ui-dialog:visible:has-text("Carregando...")');
                    await loading.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                    await loading.waitFor({ state: 'hidden', timeout: 180000 }); // Até 3 minutos para relatórios grandes
                    await page.waitForTimeout(3000);

                    console.log('Iniciando download...');
                    const downloadPromise = page.waitForEvent('download', { timeout: 240000 });
                    await page.click('button[title*="CSV"]', { force: true });
                    const download = await downloadPromise;

                    // Caminhos
                    let baseOutputPath = process.env.BASE_OUTPUT_PATH || './downloads';
                    if (process.platform === 'linux' && /^[a-zA-Z]:/.test(baseOutputPath)) {
                        baseOutputPath = baseOutputPath.replace(/^[a-zA-Z]:/, '/mnt/c').replace(/\\/g, '/');
                    }
                    const absoluteBase = path.isAbsolute(baseOutputPath) ? baseOutputPath : path.resolve(baseOutputPath);
                    const basePath = path.join(absoluteBase, filial.pasta);
                    
                    if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });

                    const yearYY = String(now.getFullYear()).slice(-2);
                    const monthMM = String(now.getMonth() + 1).padStart(2, '0');
                    const finalPath = path.join(basePath, `${yearYY}.${monthMM}.csv`);

                    if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
                    
                    await download.saveAs(finalPath);
                    console.log(`✅ ${filial.nome} concluído com sucesso!`);
                    
                    saveProgress(filial.nome);
                    success = true;

                    // Fechar diálogo se necessário
                    try {
                        const closeBtn = page.locator('.ui-dialog:visible .ui-dialog-titlebar-close');
                        if (await closeBtn.isVisible()) await closeBtn.click();
                    } catch (e) {}

                } catch (err) {
                    console.error(`❌ Erro na tentativa ${retryCount + 1} para ${filial.nome}:`, err.message);
                    retryCount++;
                    if (retryCount >= maxRetries) {
                        throw err; // Força reinício total do browser após falhas repetidas
                    }
                    await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
                }
            }
        }

        console.log('\n🏁 TODAS AS FILIAIS CONCLUÍDAS COM SUCESSO!');
        // Opcional: deletar progresso após sucesso total
        if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);

    } catch (error) {
        console.error('\n🚨 Erro crítico durante o processo. Reiniciando browser em 15s...');
        try { await page.screenshot({ path: `erro_resumo_${getTodayStr()}.png` }); } catch (e) {}
        await browser.close();
        await new Promise(r => setTimeout(r, 15000));
        return run(userIndex); // Reinicia com o mesmo usuário e continua do progresso salvo
    } finally {
        await browser.close().catch(() => {});
    }
}

run();


