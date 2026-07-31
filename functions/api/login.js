// POST /api/login  { senha }  ->  confere a senha (variável de ambiente
// ADMIN_PASSWORD, nunca no código) e, se bater, devolve um cookie de sessão
// assinado (HMAC com SESSION_SECRET) válido por 8 horas.
import { assinar, respostaJson } from './_util.js';

export async function onRequest({ request, env }) {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    let corpo;
    try {
        corpo = await request.json();
    } catch {
        return respostaJson({ erro: 'JSON inválido' }, 400);
    }

    const senhaCorreta = env.ADMIN_PASSWORD;
    const segredo = env.SESSION_SECRET;
    if (!senhaCorreta || !segredo) {
        return respostaJson({ erro: 'ADMIN_PASSWORD/SESSION_SECRET não configurados no servidor.' }, 500);
    }
    if (corpo.senha !== senhaCorreta) {
        return respostaJson({ erro: 'Senha incorreta' }, 401);
    }

    const duracaoSegundos = 8 * 60 * 60; // 8 horas
    const expira = Date.now() + duracaoSegundos * 1000;
    const valor = String(expira);
    const cookie = `admin_session=${valor}.${await assinar(valor, segredo)}; `
        + `Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${duracaoSegundos}`;

    return respostaJson({ ok: true }, 200, { 'Set-Cookie': cookie });
}
