const express = require("express");
const sharp = require("sharp");
// A linha abaixo não é estritamente necessária nas versões modernas do Node.js,
// mas não custa nada ter para garantir a compatibilidade.
const fetch = require('node-fetch');

const app = express();

// =======================================================================
//           👉 AS CHAVES SECRETAS SERÃO LIDAS DO AMBIENTE DO FLY.IO 👈
// =======================================================================
// O código vai pegar as chaves que você configurar com o comando "fly secrets set"
const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;
const ROBLOX_GROUP_ID = process.env.ROBLOX_GROUP_ID;
// =======================================================================

// Middleware para parsing JSON
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rota de status para verificar se o servidor está online
app.get("/", (req, res) => res.send("🎨 Servidor Roblox Canvas está ativo e pronto!"));

// FUNÇÃO PARA CRIAR UMA IMAGEM DIRETAMENTE
function createFinalMultipartFormData(pngBuffer, assetData) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const CRLF = '\r\n';

  const creationContext = { creator: { groupId: ROBLOX_GROUP_ID } };

  const requestJson = JSON.stringify({
    assetType: "Image", // Pedimos uma Imagem, não um Decal.
    displayName: assetData.name,
    description: assetData.description,
    creationContext: creationContext
  });

  let textPart = '';
  textPart += `--${boundary}${CRLF}`;
  textPart += `Content-Disposition: form-data; name="request"${CRLF}${CRLF}`;
  textPart += requestJson + CRLF;
  textPart += `--${boundary}${CRLF}`;
  textPart += `Content-Disposition: form-data; name="fileContent"; filename="canvas.png"${CRLF}`;
  textPart += `Content-Type: image/png${CRLF}${CRLF}`;

  const finalBody = Buffer.concat([
    Buffer.from(textPart, 'utf-8'),
    pngBuffer,
    Buffer.from(CRLF + `--${boundary}--` + CRLF, 'utf-8')
  ]);

  return {
    body: finalBody,
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

// Rota de Upload
app.post("/upload", async (req, res) => {
  try {
    console.log("📥 Recebendo dados do canvas...");

    // Verificação de segurança: garantir que as chaves foram carregadas
    if (!ROBLOX_API_KEY || !ROBLOX_GROUP_ID) {
        console.error("❌ ERRO CRÍTICO: As variáveis de ambiente ROBLOX_API_KEY ou ROBLOX_GROUP_ID não foram carregadas.");
        return res.status(500).json({ success: false, error: "Erro de configuração do servidor." });
    }

    const { imageData, width, height } = req.body;
    if (!imageData || !width || !height) {
      return res.status(400).json({ success: false, error: "Dados de imagem inválidos" });
    }

    const pixelBuffer = Buffer.from(imageData, 'base64');
    const pngBuffer = await sharp(pixelBuffer, { raw: { width, height, channels: 4 } }).png().toBuffer();
    console.log(`📊 PNG gerado: ${pngBuffer.length} bytes`);

    const formData = createFinalMultipartFormData(pngBuffer, {
        name: "Canvas Art",
        description: "Digital artwork"
    });

    console.log("📤 Enviando para Roblox API para criar uma IMAGEM...");

    const response = await fetch("https://apis.roblox.com/assets/v1/assets", {
      method: "POST",
      headers: { 'x-api-key': ROBLOX_API_KEY, 'Content-Type': formData.contentType },
      body: formData.body
    });

    const responseText = await response.text();
    const data = JSON.parse(responseText);

    console.log("📊 Status da resposta:", response.status);
    console.log("📥 Resposta bruta:", responseText);

    if (response.ok && data.path && data.path.startsWith("operations/")) {
        console.log(`✅ Upload aceito! Operação: ${data.path}`);
        console.log("🔄 Consultando operação para obter o ID da Imagem...");
        try {
            await new Promise(resolve => setTimeout(resolve, 5000));

            const operationResponse = await fetch(`https://apis.roblox.com/assets/v1/${data.path}`, {
                headers: { 'x-api-key': ROBLOX_API_KEY }
            });
            const operationData = await operationResponse.json();
            console.log("📊 Dados da operação:", JSON.stringify(operationData, null, 2));

            const imageId = operationData.response && operationData.response.assetId;
            
            if (imageId) {
                console.log(`🎯 SUCESSO! ID da Imagem obtido diretamente: ${imageId}`);
                res.json({ success: true, assetId: imageId, message: "Asset de Imagem criado com sucesso!" });
            } else {
                res.status(500).json({ success: false, message: "Operação concluída, mas sem Asset ID retornado."});
            }
        } catch (opError) {
            console.error("❌ Erro ao consultar operação:", opError);
            res.status(500).json({ success: false, message: "Erro ao consultar status da operação." });
        }
    } else {
        console.error("❌ Falha na API do Roblox:", data);
        res.status(response.status).json({ success: false, error: data });
    }
  } catch (err) {
    console.error("❌ Erro no servidor:", err);
    res.status(500).json({ success: false, error: "Erro interno: " + err.message });
  }
});

// O Fly.io define a porta através da variável de ambiente PORT.
// Usamos 3000 como fallback para testes locais.
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Servidor pronto na porta ${port}!`);
});