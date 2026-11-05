export function authFailure(error){
 const message=String(error?.message||'');
 const seconds=message.match(/(?:after|in)\s+(\d+)\s+seconds?/i);
 if(seconds)return {wait:Number(seconds[1]),message:`Veuillez attendre ${seconds[1]} secondes avant de demander un nouveau code. Le dernier courriel reçu reste utilisable.`};
 if(error?.code==='over_email_send_rate_limit')return {wait:0,message:'La limite d’envoi de courriels de connexion est atteinte. Réessayez plus tard.'};
 if(error?.status===429)return {wait:60,message:'Trop de demandes rapprochées. Attendez une minute avant de réessayer.'};
 return {wait:0,message:message||'Connexion impossible. Réessayez.'};
}
