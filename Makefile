.PHONE: render
all: render

render:
	#generate static resource (e.g. asciidoctor-diagram) first
	hugo
	#copy generated static resource
	hugo
