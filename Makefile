.PHONE: render publish
all: render publish

render:
	#generate static resource (e.g. asciidoctor-diagram) first
	hugo
	#copy generated static resource
	hugo

publish:
	git checkout master
	cp -R public/* .
	rm -rf public
	git add .
	git commit -m Update
	git push origin master
