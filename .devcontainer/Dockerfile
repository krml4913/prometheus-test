FROM docker:24.0.6-dind

################################
# 共通設定
################################
ENV NODE_OPTIONS=--max-old-space-size=4096
ENV TZ=Asia/Tokyo

RUN apk add git

RUN echo "alias g=git" >> /etc/profile
RUN echo "alias y=yarn" >> /etc/profile
COPY profile.sh /etc/profile.d/profile.sh

COPY .gitconfig.custom /root/.gitconfig.custom
RUN git config --global --add include.path "/root/.gitconfig.custom"
RUN echo -e "\n\
[include]\n\
       path = /root/.gitconfig.custom\n\
" >> /root/.gitconfig

################################
# Java
################################
RUN wget -O /etc/apk/keys/amazoncorretto.rsa.pub  https://apk.corretto.aws/amazoncorretto.rsa.pub
RUN echo "https://apk.corretto.aws/" >> /etc/apk/repositories
RUN apk update
RUN apk add amazon-corretto-17

################################
# Bun
################################
RUN apk add nodejs
# RUN corepack enable
################################
# AWS CLI
################################
# RUN mkdir /tmp/awscli && \
#      cd /tmp/awscli && \
#      curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
#      unzip awscliv2.zip && \
#      sudo ./aws/install


RUN apk add curl