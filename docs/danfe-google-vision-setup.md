# Configuração do OCR complementar para DANFE

O ISP tenta primeiro o Tesseract local. Quando uma página digitalizada produz
poucos itens ou baixa confiança, a página renderizada é enviada à função
autenticada `danfe-vision-ocr`, que chama o Google Cloud Vision. O PDF completo
não é enviado nem armazenado no Supabase; a função encaminha a imagem da página
ao Google e devolve o texto e as posições reconhecidas.

## Configurar o Google Cloud

1. Crie ou selecione um projeto no [Google Cloud Console](https://console.cloud.google.com/).
2. Ative a **Cloud Vision API** no projeto e configure faturamento e cotas.
3. Crie uma chave de API e restrinja-a à Cloud Vision API. Não use restrição por
   referenciador HTTP: a chamada é feita no servidor Supabase.
4. Confira a franquia e a política de dados vigentes no projeto antes de usar
   documentos reais. Cada página processada conta como uma imagem.

## Guardar a chave e publicar somente a função

No PowerShell, na pasta do projeto, defina a chave diretamente como segredo do
Supabase. Substitua o texto entre aspas pela chave criada no Google; não a envie
no chat nem a grave em arquivo versionado:

```powershell
npx supabase@latest secrets set GOOGLE_CLOUD_VISION_API_KEY="SUA_CHAVE_DO_GOOGLE" --project-ref xfflwtnfzxwpyydeexbx
npx supabase@latest functions deploy danfe-vision-ocr --project-ref xfflwtnfzxwpyydeexbx
```

A função requer uma sessão Supabase válida e papel ativo de administrador,
gestor de estoque ou superadministrador. A chave Google não fica no navegador.

## Conferir no sistema

Com a função configurada, atualize o ISP local, importe uma DANFE digitalizada e
observe o status da leitura. O Google Vision só será chamado para páginas em que
o OCR local reconhecer menos de quatro itens ou tiver confiança abaixo de 40.
Revise descrição, unidade e quantidade na tela antes de confirmar a entrada.

Se a função retornar HTTP 503, confira se o segredo foi definido. HTTP 502 indica
que a API recusou a chamada; confirme a Cloud Vision API, a chave, o faturamento
e as cotas do projeto Google. O OCR não altera o estoque até a confirmação normal
da entrada no ISP.
