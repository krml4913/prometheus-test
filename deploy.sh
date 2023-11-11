./gradlew build

docker build . -t sss

aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin 102120196983.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com

docker tag sss:latest 102120196983.dkr.ecr.ap-northeast-1.amazonaws.com/cdkstack-sssecr0bec2227-w7psy68foeup:latest
docker push 102120196983.dkr.ecr.ap-northeast-1.amazonaws.com/cdkstack-sssecr0bec2227-w7psy68foeup:latest