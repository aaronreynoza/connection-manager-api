echo "Starting DB..."

DATABASE_ROOT_PASSWORD=${DATABASE_ROOT_PASSWORD:="mcm"}
DATABASE_USER=${DATABASE_USER:="mcm"}
DATABASE_PASSWORD=${DATABASE_PASSWORD:="mcm"}
DATABASE_SCHEMA=${DATABASE_SCHEMA:="mcm"}
DATABASE_TAG=${DATABASE_TAG:-"8"}
DATABASE_STARTUP_WAIT_IN_SECONDS=${DATABASE_STARTUP_WAIT_IN_SECONDS:-"15"}

docker run -d --rm --name mysql-mbox-mcm -p 3306:3306 -e MYSQL_ROOT_PASSWORD=$DATABASE_ROOT_PASSWORD -e MYSQL_USER=$DATABASE_USER -e MYSQL_PASSWORD=$DATABASE_PASSWORD -e MYSQL_DATABASE=$DATABASE_SCHEMA mysql:$DATABASE_TAG

echo "Starting DB - waiting $DATABASE_STARTUP_WAIT_IN_SECONDS for DB to startup..."

sleep $DATABASE_STARTUP_WAIT_IN_SECONDS

echo "Starting DB - running 'npm run migrate-and-seed' to initialise database and seeds..."

npm run migrate-and-seed

echo "Starting DB - done!"
