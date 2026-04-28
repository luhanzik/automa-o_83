const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

chromium.use(stealth);

// --- CONFIGURAÇÃO DE USUÁRIOS (Ordem: Gabriel -> Luhan -> Esther) ---
const USERS = [
    { email: 'gabriel.silva@transcleber.com.br', pass: 'Gabr2312!*' },
    { email: 'luhan.vinicius@transcleber.com.br', pass: 'Luhan123@@' },
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

async function run(userIndex = 0, cdIndex = 0) {
    if (userIndex >= USERS.length) {
        console.log('❌ Todos os usuários atingiram o limite de hoje.');
        return;
    }
    if (cdIndex >= FILIAIS.length) {
        console.log('✅ Todas as filiais foram processadas com sucesso!');
        return;
    }

    const currentUser = USERS[userIndex];
    const stateFile = `state_${currentUser.email.split('@')[0]}.json`;
    
    console.log(`\n================================================`);
    console.log(`USUÁRIO: ${currentUser.email}`);
    console.log(`FILIAL ATUAL: ${FILIAIS[cdIndex].nome} (${cdIndex + 1}/${FILIAIS.length})`);
    console.log(`================================================\n`);

    const browser = await chromium.launch({
        headless: false,
        args: ['--start-maximized']
    });

    const contextOptions = fs.existsSync(stateFile) ? { storageState: stateFile } : {};
    const context = await browser.newContext({
        ...contextOptions,
        viewport: null,
        acceptDownloads: true
    });

    const page = await context.newPage();

    try {
        console.log('Acessando página de relatórios...');
        await page.goto(process.env.REPORT_URL, { waitUntil: 'networkidle' });

        if (page.url().includes('login.xhtml')) {
            console.log('Sessão expirada. Fazendo login...');
            await page.fill('#username', currentUser.email);
            await page.fill('#password', currentUser.pass);
            await page.click('#j_idt9');

            try {
                const errorMsg = page.locator('.ui-messages-error-detail, .ui-growl-item');
                if (await errorMsg.isVisible({ timeout: 5000 })) {
                    const msgText = await errorMsg.innerText();
                    console.log(`⚠️ Erro no login: ${msgText}`);
                    await browser.close();
                    // Se for erro de senha ou limite, pula para o próximo usuário
                    return run(userIndex + 1, cdIndex);
                }
            } catch (e) {}

            try {
                const popupOk = page.locator('#usuarioLogadoOK');
                await popupOk.waitFor({ state: 'visible', timeout: 5000 });
                await popupOk.click();
            } catch (e) {}

            await page.waitForURL(url => url.toString().includes('private'), { timeout: 30000 });
            await page.goto(process.env.REPORT_URL, { waitUntil: 'networkidle' });
            await context.storageState({ path: stateFile });
        } else {
            // Mesmo se já logado, salvar estado atualizado
            await context.storageState({ path: stateFile });
        }

        // --- SELEÇÃO ÚNICA DE RELATÓRIO (Fazer uma vez no início) ---
        console.log('Selecionando Relatório: 14 - Tracking 360...');
        await page.locator('div[id="form:grupo"] .ui-selectonemenu-trigger').click({ delay: 500 });
        await page.waitForTimeout(1500);
        await page.locator('.ui-selectonemenu-panel:visible li').filter({ hasText: /^14 -/ }).click({ delay: 300 });
        await page.waitForTimeout(3000);

        console.log('Selecionando Sub-Relatório: 83 - Entregas...');
        await page.locator('div[id*="relatorio"] .ui-selectonemenu-trigger, .ui-selectonemenu:not(.ui-state-disabled)').last().click({ delay: 500 });
        await page.waitForTimeout(1500);
        await page.locator('.ui-selectonemenu-panel:visible li').filter({ hasText: /^83 -/ }).click({ delay: 300 });
        await page.waitForTimeout(3000);

        // Loop pelas filiais restantes
        for (let i = cdIndex; i < FILIAIS.length; i++) {
            const filial = FILIAIS[i];
            console.log(`\n>>> Processando: ${filial.nome}...`);

            console.log('Abrindo filtros...');
            await page.click('button[id="form:bt_filtro"]', { delay: 500 });
            await page.waitForTimeout(2000);

            // Datas
            const now = new Date();
            const todayDay = String(now.getDate());
            await page.locator('input[id$=":0:data__input"]').click();
            await page.click('.ui-datepicker-calendar:visible a:text-is("1")');
            await page.waitForTimeout(1000);
            await page.locator('input[id$=":1:data__input"]').click();
            await page.click(`.ui-datepicker-calendar:visible a:text-is("${todayDay}")`);
            await page.waitForTimeout(1000);

            // Selecionar Filial
            console.log(`Selecionando CD ${filial.nome}...`);
            await page.locator('label[id$=":2:mq__label"]').click({ force: true });
            await page.waitForTimeout(1500);

            // Desmarcar tudo primeiro (Garante que só a desejada será marcada)
            const panel = page.locator('.ui-selectcheckboxmenu-panel:visible');
            const allCheckbox = panel.locator('.ui-selectcheckboxmenu-header .ui-chkbox-box');
            
            // Lógica para desmarcar tudo: clica no "marcar todos" e depois desmarca
            await allCheckbox.click();
            await page.waitForTimeout(500);
            await allCheckbox.click();
            await page.waitForTimeout(800);

            // Agora marca a filial correta (case-insensitive)
            await panel.locator('li').filter({ hasText: new RegExp(`^${filial.nome}$`, 'i') }).locator('.ui-chkbox-box').click({ force: true });
            await page.waitForTimeout(800);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);

            console.log('Consultando...');
            await page.click('.ui-dialog:visible button:has-text("consultar")');

            // Verificação de Limite de Execução
            try {
                // Procura por qualquer elemento que contenha o texto de limite (case-insensitive)
                const limitMsg = page.locator('text=/limite de execução/i');
                if (await limitMsg.count() > 0 && await limitMsg.first().isVisible({ timeout: 7000 })) {
                    const text = await limitMsg.first().innerText();
                    console.log(`⚠️ LIMITE DETECTADO: "${text}"`);
                    console.log(`⚠️ Trocando de usuário (${userIndex + 1} -> ${userIndex + 2})...`);
                    await browser.close();
                    return run(userIndex + 1, i); // Tenta a MESMA filial com o próximo usuário
                }
            } catch (e) {
                console.log('Dica: Nenhuma mensagem de limite detectada nos primeiros segundos.');
            }

            console.log('Aguardando carregamento...');
            const loading = page.locator('.ui-dialog:visible:has-text("Carregando...")');
            await loading.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
            await loading.waitFor({ state: 'hidden', timeout: 120000 });
            await page.waitForTimeout(2000);

            console.log('Iniciando download CSV...');
            const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
            await page.click('button[title="Download de Arquivo CSV - separado por \',\'"]', { force: true });
            const download = await downloadPromise;

            // Salvar na pasta correta
            let baseOutputPath = process.env.BASE_OUTPUT_PATH || './downloads';
            
            // CORREÇÃO CRÍTICA: Se rodar no Linux (WSL/Airflow) e o caminho for do Windows (C:)
            if (process.platform === 'linux' && /^[a-zA-Z]:/.test(baseOutputPath)) {
                console.log('Ambiente Linux detectado com caminho Windows. Convertendo para /mnt/c...');
                baseOutputPath = baseOutputPath.replace(/^[a-zA-Z]:/, '/mnt/c').replace(/\\/g, '/');
            }

            // Forçar o caminho a ser absoluto
            const absoluteBase = path.isAbsolute(baseOutputPath) ? baseOutputPath : path.resolve(baseOutputPath);
            const basePath = path.join(absoluteBase, filial.pasta);

            const yearYY = String(now.getFullYear()).slice(-2);
            const monthMM = String(now.getMonth() + 1).padStart(2, '0');
            const finalPath = path.join(basePath, `${yearYY}.${monthMM}.csv`);

            console.log(`Caminho Final: ${finalPath}`);
            
            if (fs.existsSync(finalPath)) {
                console.log(`Substituindo arquivo existente: ${finalPath}`);
                fs.unlinkSync(finalPath);
            }
            
            await download.saveAs(finalPath);
            console.log(`✅ ${filial.nome} concluído: ${finalPath}`);
            
            // Fechar o diálogo de filtros se ele ainda estiver aberto
            try {
                const closeBtn = page.locator('.ui-dialog:visible .ui-dialog-titlebar-close');
                if (await closeBtn.isVisible()) await closeBtn.click();
            } catch (e) {}
        }

        console.log('\n🏁 TODAS AS FILIAIS CONCLUÍDAS COM SUCESSO!');

    } catch (error) {
        console.error('❌ Erro crítico:', error);
        const errorPath = `erro_${FILIAIS[cdIndex].pasta}_u${userIndex}.png`;
        await page.screenshot({ path: errorPath });
        console.log(`Screenshot do erro salva em: ${errorPath}`);
    } finally {
        await browser.close();
        console.log('Navegador fechado.');
    }
}

run();

