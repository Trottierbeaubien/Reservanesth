# HDQ — Choix des salles

Application distincte de RéservAnesth, publiée dans le sous-dossier `choix-salles`.
Le backend utilise uniquement les tables `hdq_*`, le bucket privé `hdq-programmes`
et la fonction Edge `hdq-choice` du projet Supabase existant. Les ressources
`ra_*` et la fonction `push-worker` ne sont pas modifiées.

## Fonctionnement

- Répertoire de l’équipe, 14 rangs quotidiens, salles ouvertes et affectations particulières.
- Les notes Absent, académique, administratif et CMS font sauter le tour.
- Un membre choisit uniquement à son tour. La personne qui démarre la ronde
  peut choisir pour le collègue attendu et corriger les affectations.
- Les salles choisies disparaissent de Disponibles et restent grisées dans Toutes.
- Le choix personnel et les doubles affectations sont visibles dans Ma salle.
- Une nouvelle ronde efface le programme, les rangs, les choix, les affectations
  et les notifications précédents pour tous; le répertoire est conservé.
- Si la clinique est fermée, un appel aux volontaires vise les membres hors rangs.
  Les réponses restent par texto au groupe, sans réservation dans l’application.
- Photo directe, importation, repères par salle, PDF affectations et PDF complet.
- Notifications Web Push et pastille indiquant un choix en attente.

## Configuration

La clé publishable/anon dans `web/config.js` est publique par conception.
Aucune clé `service_role`, clé Brevo, clé privée Web Push ou image opératoire
n’est stockée dans ce dépôt. Tous les accès aux données passent par la fonction
Edge, qui vérifie la session Supabase et l’appartenance à l’équipe HDQ.
Les tables ont RLS activée et aucun droit direct pour `anon` ou `authenticated`.
La fonction de commit est réservée à `service_role` et protège la révision par CAS.
Les paramètres privés sont dans `hdq_runtime`, inaccessible aux clients.

Le propriétaire renseigne Brevo dans Connexion Brevo (clé API, expéditeur validé,
destinataires). Aucun test courriel n’est envoyé automatiquement. Une réponse
partielle ou ambiguë impose une vérification dans Brevo avant un nouvel envoi.
Les noms et les adresses de connexion sont saisis dans Préparer la journée.
Leurs adresses doivent correspondre aux comptes Supabase. Sur iPhone, installer
sur l’écran d’accueil puis activer les notifications depuis cette icône.
Une notification n’est pas un accusé de lecture ni une garantie de livraison.

## Développement

`pnpm install`, `pnpm test`, `pnpm build`.
Le build produit `dist/` (interface statique) et les fichiers de la fonction Edge.
Après modification du backend, redéployer `hdq-choice` avec authentification
interne activée : chaque requête est vérifiée par `auth.getUser(token)` et par
la liste HDQ. Le contrôle JWT de la passerelle est remplacé par cette vérification
pour prendre en charge les clés publishable.

Les tests utilisent des personnes et documents fictifs. Aucun courriel ni push
réel n’est envoyé par les tests. La réception réelle sur iPhone et la délivrabilité
Brevo doivent être validées par les utilisateurs après configuration.

## Repérage et essai du coordonnateur

Les listes sont triées par nom de famille. Les rangs saisis restent inchangés.
Le repérage OCR est effectué sur l’appareil : seuls les en-têtes « SALLE NUMÉRO »
et leurs coordonnées sont conservés. Les fichiers publics du moteur Tesseract
sont téléchargés; aucune image n’est envoyée à un service OCR externe.
Chaque section va de son en-tête au suivant. Les en-têtes hors liste servent
aussi de limites. Toutes les sections C/C1/C2 sont réunies dans l’entrée CIC,
y compris si elles sont séparées par une autre salle. Les limites sont ajustables
section par section. Si une salle n’est pas reconnue, une indication invite à vérifier
les repères; le programme complet reste accessible par son bouton dédié.

Le mode essai permet au coordonnateur de simuler tous les tours sans compléter
les adresses des collègues. Notifications et courriels sont alors dirigés vers
son adresse seulement; les PDF sont marqués ESSAI. La désactivation du mode est
réservée au propriétaire lors de la préparation d’une nouvelle ronde.
Le suivi de ronde affiche les personnes sautées, en attente, au tour et affectées.
En mode équipe, le responsable reçoit des notifications de progression.

La clinique préop ouverte est une activité à choisir dans les rangs, sans section OCR.
La lecture privilégie les gros caractères et le contraste. L’icône HDQ bleue
représente un masque incliné avec son circuit. Le paramètre ?apercu=visuel montre
uniquement des données fictives et bloque toutes les actions réseau de l’application.
Le repérage v2 ajoute des bandes locales chevauchantes à haute résolution pour
les longs scans; les anciens repérages sont repris automatiquement une fois.
