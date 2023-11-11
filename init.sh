alias g=git
alias y=yarn
alias n=npm

git config --global --add include.path "/workspaces/prometheus-test/.devcontainer/.gitconfig.custom"

sdk install java 17.0.9-amzn
sdk use java 17.0.9-amzn