##########################################################################
from django.conf.urls import patterns, url, include

urlpatterns = patterns('',
    
    url(r'^record$', 'api.recorder.recorder.record')
)