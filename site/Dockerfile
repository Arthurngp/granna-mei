FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html documentacao.html faq.html base.css doc.css home.css robots.txt sitemap.xml llms.txt origem.js manutencao.html /usr/share/nginx/html/
COPY mei /usr/share/nginx/html/mei
COPY lps-redirects.inc /etc/nginx/conf.d/lps-redirects.inc
COPY img /usr/share/nginx/html/img
