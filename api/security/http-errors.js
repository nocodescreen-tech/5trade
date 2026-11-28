'use strict';
function classify(error) {
  const code=error?.code;
  const type=error?.type;
  if (code==='LIMIT_FILE_SIZE'||code==='LIMIT_FILE_COUNT'||code==='LIMIT_PART_COUNT'||code==='LIMIT_FIELD_COUNT'||code==='LIMIT_FIELD_VALUE'||type==='entity.too.large'||type==='parameters.too.many') {
    return [413,'Limite de taille ou de nombre dépassée'];
  }
  if (code==='UPLOAD_FORMAT'||type==='encoding.unsupported'||type==='charset.unsupported') return [415,'Format ou encodage non pris en charge'];
  if (code==='LIMIT_UNEXPECTED_FILE'||code==='LIMIT_FIELD_KEY'||code==='MISSING_FIELD_NAME'||type==='entity.parse.failed'||type==='request.aborted'||type==='request.size.invalid') return [400,'Requête ou fichier invalide'];
  if (error?.name==='MulterError') return [400,'Téléversement invalide'];
  return [500,'Erreur interne du serveur'];
}
function notFound(req,res){return res.status(404).json({success:false,error:'Route API introuvable'});}
function handle(error,req,res,next){
  if(res.headersSent)return next(error);
  const [status,message]=classify(error);
  if(status===500)console.error('[HTTP] Traitement indisponible');
  return res.status(status).json({success:false,error:message});
}
function mount(app){app.use('/api',notFound);app.use(handle);}
module.exports={classify,notFound,handle,mount};
